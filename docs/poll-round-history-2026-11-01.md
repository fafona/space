# Poll round selection and reversible deletion

Status: implemented and verified locally; not merged or deployed. Based on
`fe11d715e62fe3d014492b995e94fb929b07a20d`, isolated branch
`feat/poll-round-history-20261101`. No production requests or user-data mutations.

## Root cause

The editor's previous "new round" operation only replaced the poll ID, aliases,
status and schedule. It did not retain the previous editor definition. Statistics
could infer historical rounds from ballots, but zero-ballot rounds and editor
settings absent from ballot snapshots could not be recovered that way.

## Behavior

- New rounds archive the previous round's exact questions, draft text, aliases,
  schedule, audience and poll-specific settings. Layout is shared by the block;
  history is flat and is not recursively copied into each snapshot.
- A selector switches the editor between retained rounds without discarding
  changes. Current buffered text **and the parent's queued block patches** are
  committed before snapshots and before switching. The latter uses the existing
  editor flush function in both desktop/mobile editor render paths.
- "Delete this round" asks for confirmation and moves it into a recoverable
  deleted list. It does not issue DELETE requests or erase ballots/statistics.
  Deleting the current round does not silently activate an older round. The
  deleted public component renders nothing; published lookup rejects deleted
  block definitions. A separately published live copy remains independent.
- Changes are drafts until saved/published. Desktop/mobile or other block copies
  must be synchronized through existing editor controls; deletion is not an
  unannounced tenant-wide data mutation.
- Legacy history loading is authenticated via the existing `/api/polls` GET and
  filtered by block ID. Recovering a legacy round uses its latest ballot snapshot,
  defaults to closed and warns that the old snapshot lacks some editor settings.
  Old zero-ballot rounds without saved definitions cannot be reconstructed.
- Async results are ignored after editor/merchant unmount. No schema, migrations,
  ballot submission/write authorization or permanent result-deletion changes.

## Verification

- `npm run test:polls`: 32 tests passed, covering existing polling behavior and
  new archive, storage/sanitizer round-trip, alias deduplication, exact draft
  retention, deletion/restore and legacy recovery.
- `npm run test:polls-browser`: 4 isolated Chromium acceptance cases, including
  desktop/mobile real components, RAF-queued parent patches, buffered text,
  refresh/restore, cancelled/failed actions, legacy scoping and late results.
  Every request is intercepted; unexpected requests fail the case. Synthetic
  data only; no real account, public site or database is contacted.
- 17 existing block storage, style-transfer and buffered-commit tests passed.
- TypeScript no-emit check passed. ESLint: 0 errors; 5 existing internal-navigation
  warnings in AdminClient, outside the two added callback lines.

Deployment is not part of this completed local implementation. It requires the
normal build/release checks; no existing pending release candidate was modified.
