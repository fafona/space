// Read-only leaf: observation must never import an executing CLI module.
import {existsSync} from 'node:fs';
import {INTERRUPTED_RECOVERY as H} from './release-toolchain-interrupted-recovery-contract.mjs';
import {RECOVERED_PUBLICATION as R} from './release-toolchain-recovered-publication-contract.mjs';

export function hasRecoveredPublicationDisposition() {
  return existsSync(H.root + '/recovery/completed.json') || existsSync(R.root);
}
