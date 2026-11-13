# Storage lifecycle

This is independent maintenance, not a step in application publication. It does
not turn a completed release into a failed release, change traffic, restart PM2,
modify user data, or send mail. A scheduler failure is an operations warning.

## Schedules and boundaries

- Every five minutes, check the active ordinary publication's completed proof
  and retention head. A newly completed publication or retirement starts a new
  event. Incomplete publications never authorize cleanup.
- Reclaim **only webpack caches** of already-certified stopped web releases,
  after full retention history, current/rollback, process/FD/environment/maps,
  saved primary and backup PM2 dumps, pending states, static/Nginx, mounts,
  schedulers, containers, and cross-release dependency links have been checked.
- Acquire the unchanged deployment/operation locks before qualification and
  deletion. Revalidate every candidate and all protected state. Preserve durable
  intent, per-cache receipts, completed/failed evidence. Never automatically
  retry an event with an incomplete destructive attempt.
- Do not stop historical online processes, alter saved dumps, delete dependency
  trees/source/static assets, clean Docker, or expire database/recovery backups.
  Those require separate lifecycle qualification. A release that keeps previous
  processes online will still consume space; this task does not pretend otherwise.
- Daily at 04:40 UTC (up to ten minutes jitter), record read-only allocated-space
  inventory, current/rollback, generation count, cache/dependency components and
  daily net growth. Parent category totals and their components are not additive.
- Warning below **30 GiB** free; critical below **20 GiB** (the existing build
  floor is unchanged). Warn on measured daily growth reaching that floor within
  seven days. No projection from short/incomparable measurement intervals.
- Alerts are **local systemd journal and private JSON**, not email/SMS. Daily
  critical pressure fails the inspection unit for systemd visibility. Existing
  encrypted backup, journald and Nginx/Docker log retention are not duplicated.

## Reviewed installation

After full PR and main CI, use the existing source-only bootstrap to install the
exact main source. Run `release-toolchain-storage-install.mjs` from that immutable
source. It independently checks required CI, unchanged application/dependencies/
migrations against the reviewed baseline, full source bytes and protected host
pins. It inspects before enabling timers and verifies systemd unit syntax. It
never overwrites existing units or an earlier installation attempt. Failure
retains evidence and disables only its newly owned timers.

The installation receipt binds an immutable tool source. Later application/main
changes do not authorize new tool bytes or disable the existing observer; each
invocation reattests the installed source and each cleanup reads fresh host
facts. Updating these tools is a new reviewed operations installation, not a
timer downloading arbitrary main code.

## Inspection and response

Private records: `/var/lib/faolla-storage-lifecycle/` (`daily-latest.json`,
`reports/`, `events/`, installation and scheduler receipts).

```
systemctl list-timers 'faolla-storage-*'
systemctl status faolla-storage-daily.service faolla-storage-post-release.service
journalctl -u faolla-storage-daily.service -u faolla-storage-post-release.service
```

`release-toolchain-storage-host.mjs inspect` is read-only candidate inspection;
`daily` records an inspection; `poll` processes a fresh completed event. None
accept arbitrary directory, target, fixture or bypass flags. Low-priority I/O,
20% CPU, 512 MiB and ten-minute execution bounds keep maintenance bounded.
If qualification fails, retain all evidence and investigate. Do not remove an
attempt marker or repeatedly invoke deletion. Manual retirement may make a new
retention-head event eligible but cannot erase an earlier incomplete attempt.
