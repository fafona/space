# Failed prepare recovery and process continuity

## Evidence and recovery

Normal prepare run 35395021973 failed after installing the maintenance ingress but before stopping the old worker/web. Main CI and the read-only plan had passed. The failure was unrelated to disk headroom: the existing disk and ext4 root had been expanded to 120 GiB.

Frozen/current proofs had identical boot, PID, start ticks, ancestry, executable, command digest, PM2 generation, runtime and environment. Only procfs virtual inode/mtime/ctime differed for the daemon and worker descendants/native helpers. The daemon had an existing bound continuity check; historical managed/native comparisons still required exact virtual metadata.

The user authorized controlled recovery followed by repair/deployment. The exact failed operation dc89b235-e4cf-4d1b-af5c-f2016e568ecb was restored using the incident-only recovery script, standard deployment flock and private operation lock. It verifies the immutable state digest and unchanged old runtime, existing ingress proof, local proxy-equivalent pages, then restores only that operation's ingress changes and checks both public domains with the existing full smoke checker. No process was restarted, and no database or business data was modified. Failed state remains byte-for-byte in merchant-space.archived-35395021973; separate started/completed receipts preserve recovery evidence. Recovery is consumed and must not be replayed.

At 21:23 UTC, the old build 1aab7b9beb10d0f86f5354b873d8a56c85cae576 had an owned web process, running worker, healthy operations and approximately 82 GiB free. New code was not yet deployed.

## Permanent change

- Historical managed process comparisons use the same boot-bound lifetime rules already used for the daemon. Only procfs inode/mtime/ctime can differ; all other process facts, PM2 generation, tree membership and native file/package evidence remain exact.
- Native live verification uses a current, fully validated process observation, binds it to the frozen lifetime, then performs two exact fresh observations and compares the unchanged historical file/package evidence.
- Before delete, a final exact fresh process-tree comparison remains mandatory. PID reuse, reparenting, executable/configuration changes, boot changes, PM2 restart and fresh sampling races fail closed.
- Confirmed launch-journal comparisons retain the immutable original receipt and bind historical lifetime; no new launch authority, retransmission or state refresh is introduced.
- Candidate/resumed checks and paired snapshots use the same historical semantics, so the same root cause cannot recur at end-of-deployment verification.

## Verification

Targeted runtime/native/daemon/PM2/launch-journal/incident tests: 139 passed, one Linux-only test skipped on Windows. Targeted lint and strict encoding pass. Hosted CI remains required before release; this is not a claim of deployment completion or a successful real user Google sign-in.
