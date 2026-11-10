// Explicit PM2 6.0.14 resurrection representation. Historical normalizers and
// their byte pins remain unchanged; no online/unknown PID is manufactured.
import {normalizeRetirementProcess} from './online-release-retirement.mjs';
export function normalizeResurrectedRetirementProcess(raw){
 if(raw?.pid===undefined&&raw?.pm2_env?.status==='stopped'&&!Object.hasOwn(raw,'pid'))return normalizeRetirementProcess({...raw,pid:0});
 return normalizeRetirementProcess(raw);
}
