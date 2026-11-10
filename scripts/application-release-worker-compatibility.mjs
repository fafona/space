// History is fully validated first. Only certified boot events preserving both
// website anchors may be omitted from the old *website succession* projection;
// original v1 behavior and every original release/rollback rule stay unchanged.
import {assertApplicationWorkerSuccessor} from './application-release-policy.mjs';
import {assertOnlineRetentionHistory} from './online-release-retention-policy.mjs';
export function assertRebootAwareApplicationWorkerSuccessor({history,publication,actualActive}){
 assertOnlineRetentionHistory(history);
 return assertApplicationWorkerSuccessor({history:{...history,entries:history.entries.filter(c=>c.kind!=='host-reboot')},publication,actualActive});
}
