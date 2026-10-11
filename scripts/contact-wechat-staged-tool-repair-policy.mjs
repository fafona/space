// Separately approved checker-only repair of ONE already-built, never-cut
// contact candidate. These observed byte pins are not a generic pending bypass.
import assert from 'node:assert/strict';

const target = '9a877c86de64b094aa9268d9c03fb0ccec57b926';
export const CONTACT_WECHAT_STAGED_REPAIR = Object.freeze({
  target,
  baseline: 'a535a308e21f121e7cf410a6f7d84c974eb370a6',
  operation: `/var/lib/faolla-online-release/${target}`,
  directory: `/www/wwwroot/merchant-space.web-releases/${target.slice(0, 12)}-online`,
  name: `merchant-space-online-${target.slice(0, 12)}`,
  port: 3104,
  receiptName: 'contact-wechat-staged-tool-repair.json',
  // Created once by the approved runner, never assumed to exist in the original
  // failed attempt. Its bytes must equal the original pinned state below.
  originalStateCopyName: 'contact-wechat-staged-original-state.json',
  candidatePid: 531923,
  candidateProcessSha256: '6653ae6c9b560bfb1ec1d2dabf6ee0c05d18f40319c01916fdd310f863c2e2f5',
  candidateProcessEnvironmentSha256: '1b9ac09da027ba907d98af4c1f82aec0a6454027d1024d252bb1c7c47ba8a101',
  candidateProcessCommandSha256: '27b1c4018acc951f78bba448089ba571e34d9730f9040f2c951666092a3243c0',
  candidateProcessExecutable: '/usr/bin/node',
  stateSha256: '6a4febe8ebbc297613d351cec219f940bf0beabbd8cc5da903da0bfca4b68bbd',
  buildProofSha256: 'c5a7512e8ce08bac9e5a4b76baa9f0c45d664bb302e9ad55cf482120cf4435c7',
  // Git-order ls-tree -r -z records, excluding only the exact eleven tool paths,
  // joined with NUL and no trailing NUL. All other application inputs stay 9a877.
  sourceInputsSha256: '23875e19fb95213c1acb356debbd75aaed644c7948aca52da7cc7c539d411f20',
  // attendanceRepairTreeFingerprint: .next excludes ONLY root cache and trace;
  // node_modules permits only owned links resolving internally to its own root.
  builtOutputSha256: 'd475c2782d282d9a857f7f661536afcf453e7aef2820262ea29a6b8682e1c97c',
  dependencySha256: 'cb0428251f3bfe2c700eedd3242d3506e0bdd556511852f9810e7dd62e9b63fe',
  activeSha256: 'c848d358369cfee8963d1f034ca87eb1c8b82df586789b18603802bdbd68a142',
  maintenanceSha256: '1443543536254a8b9edf318ef5382789cf1df62f4e8dfe72c60a1d003a60b673',
  markerSha256: '487d4192e05edbabac37d7e560e1cb29d07e4fc3455d034402d6f7939a8a6468',
  retentionHeadSha256: '7407f4e12fdc4106de16d5e63214a3a1cab778461d449aeeac2c3528d31b7402',
});

export const CONTACT_WECHAT_STAGED_REPAIR_FILES = Object.freeze([
  'scripts/contact-wechat-staged-tool-repair-policy.mjs',
  'scripts/contact-wechat-staged-tool-repair-policy.test.mjs',
  'scripts/contact-wechat-staged-tool-repair.mjs',
  'scripts/contact-wechat-staged-tool-repair.test.mjs',
  'scripts/online-traffic-release.mjs',
  'scripts/online-traffic-release.test.mjs',
  'scripts/prepare-online-release-tool.mjs',
  'scripts/prepare-online-release-tool.test.mjs',
  'scripts/attendance-staged-tool-repair.test.mjs',
  'scripts/contact-wechat-release-policy.test.mjs',
  'scripts/online-unpublished-candidate.test.mjs',
]);

export const CONTACT_WECHAT_STAGED_REPAIR_PRESERVED = Object.freeze({
  'state.json': CONTACT_WECHAT_STAGED_REPAIR.stateSha256,
  'attendance-build-proof.json': CONTACT_WECHAT_STAGED_REPAIR.buildProofSha256,
  'BUILD_ID': '42bb0c417f2442bb9b9ed1155971fb0aaa59c8bd04a7e2c3b306b520a41398b1',
  'runtime.json': '9d88c6bb450e15cf7c4175673f763e748718a1ef15cea3c4024fb9c06ecbfa0a',
  'attendance-build.env': '3d6905a526813799544da690c2689deffb058dc98264724d761ffa00fee4ebdc',
  '.env.local': '7ea159892a0e3c153afc0d47a1a5c8877a3e7ddaff498b4988e3d95b61c02356',
  'package-lock.json': '34252b297a23562219d5b29ec773a761dda3c9fe88f18cb7c0bff122b773254c',
  'stage.log': '5f8ee2528229fe4474af924ee892c3acc3987bc1c5de1ec6d2ad06208699b9b4',
  'stage-result.json': '8fe070b02948118ca6e8f72531cb913b31f9987391f01c84289df0038846b587',
  'restored.json': 'da01745fdf5589f94c67fe31d162a2c3acea7da64c6c3a9337434962d8541ddf',
  'before.json': '7c55c5c32cdffabe2b9ef0543bcc1e5d339989f56d0590bf57f65c2071bfd8b3',
  'main-ci.json': 'bc91da294b92ffb8a578d0bbb48a13794f52b3f36dc81a86b79da7ac5e3097fa',
  'readiness-diagnostic.json': 'fe300ad8b91e887c91a17c66596b3b717705eea07f0bd629353b1c6c17bddb2c',
  'before-e6718553d7a03bef1e991fe6b6898cab_www.faolla.com.conf': 'ff7104caafcca9c6578caacfb1305fdcf1438a1f09ecda131aac33d1d863a60c',
  'after-e6718553d7a03bef1e991fe6b6898cab_www.faolla.com.conf': 'c039dadbac1cfb9439203548f36fc7c235d0cc45d02881a6915b9885cca21188',
  'before-no_store_entries_www.faolla.com.conf': '2be8bb00e785f713f3119c569de014e4d2ca1d77e14bd900dc9e9fa454d33b52',
  'after-no_store_entries_www.faolla.com.conf': 'e8bc4dd372d0091b259b2142abbc19580f4b02950379d1970dfc8d6c8f2ad134',
  'before-faolla_contact_card_release.conf': '9da32c319f61ddfdc38f24cb908536f4b57cc8ad8d0d1c4d30122176378893c5',
  'after-faolla_contact_card_release.conf': 'd0f46a50aa8a67f141d4da08d327eca52500ada41cb262e8ec050144be5da415',
});

const operation = CONTACT_WECHAT_STAGED_REPAIR.operation;
const directory = CONTACT_WECHAT_STAGED_REPAIR.directory;
const audit = `/var/lib/faolla-contact-publication/${target}`;
export const CONTACT_WECHAT_STAGED_REPAIR_PATHS = Object.freeze({
  'state.json': `${operation}/state.json`,
  'attendance-build-proof.json': `${operation}/attendance-build-proof.json`,
  'BUILD_ID': `${directory}/.next/BUILD_ID`,
  'runtime.json': `${operation}/runtime.json`,
  'attendance-build.env': `${operation}/attendance-build.env`,
  '.env.local': `${directory}/.env.local`,
  'package-lock.json': `${directory}/package-lock.json`,
  'stage.log': `${audit}/stage.log`,
  'stage-result.json': `${audit}/stage-result.json`,
  'restored.json': `${audit}/restored.json`,
  'before.json': `${audit}/before.json`,
  'main-ci.json': `${audit}/main-ci.json`,
  'readiness-diagnostic.json': `${audit}/readiness-diagnostic.json`,
  'before-e6718553d7a03bef1e991fe6b6898cab_www.faolla.com.conf': `${operation}/before-e6718553d7a03bef1e991fe6b6898cab_www.faolla.com.conf`,
  'after-e6718553d7a03bef1e991fe6b6898cab_www.faolla.com.conf': `${operation}/after-e6718553d7a03bef1e991fe6b6898cab_www.faolla.com.conf`,
  'before-no_store_entries_www.faolla.com.conf': `${operation}/before-no_store_entries_www.faolla.com.conf`,
  'after-no_store_entries_www.faolla.com.conf': `${operation}/after-no_store_entries_www.faolla.com.conf`,
  'before-faolla_contact_card_release.conf': `${operation}/before-faolla_contact_card_release.conf`,
  'after-faolla_contact_card_release.conf': `${operation}/after-faolla_contact_card_release.conf`,
});

const receiptKeys = ['schemaVersion', 'kind', 'target', 'baseline', 'toolRevision',
  'originalStateSha256', 'originalBuildProofSha256', 'sourceInputsSha256', 'builtOutputSha256',
  'preservedFiles', 'activeSha256', 'maintenanceSha256', 'markerSha256', 'retentionHeadSha256',
  'dependencySha256', 'changedToolFiles', 'approvedNoRebuild', 'preparedAt'];
const need = ok => { if (!ok) throw Error('contact_wechat_staged_repair_receipt_invalid'); };
function record(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const own = Reflect.ownKeys(value);
  return own.length === keys.length && keys.every(key => Object.hasOwn(value, key) &&
    Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'));
}

export function assertContactWechatStagedRepairReceipt(r, {target: expectedTarget, toolRevision} = {}) {
  need(record(r, receiptKeys));
  const p = CONTACT_WECHAT_STAGED_REPAIR;
  need(r.schemaVersion === 1 && r.kind === 'contact-wechat-staged-tool-repair' &&
    r.target === p.target && r.baseline === p.baseline &&
    (expectedTarget === undefined || expectedTarget === p.target) &&
    typeof r.toolRevision === 'string' && /^[a-f0-9]{40}$/.test(r.toolRevision) &&
    ![p.target, p.baseline].includes(r.toolRevision) &&
    (toolRevision === undefined || r.toolRevision === toolRevision) &&
    r.originalStateSha256 === p.stateSha256 && r.originalBuildProofSha256 === p.buildProofSha256 &&
    r.sourceInputsSha256 === p.sourceInputsSha256 && r.builtOutputSha256 === p.builtOutputSha256 &&
    r.dependencySha256 === p.dependencySha256 && r.activeSha256 === p.activeSha256 &&
    r.maintenanceSha256 === p.maintenanceSha256 && r.markerSha256 === p.markerSha256 &&
    r.retentionHeadSha256 === p.retentionHeadSha256 && r.approvedNoRebuild === true);
  need(record(r.preservedFiles, Object.keys(CONTACT_WECHAT_STAGED_REPAIR_PRESERVED)));
  try { assert.deepEqual(r.preservedFiles, CONTACT_WECHAT_STAGED_REPAIR_PRESERVED); }
  catch { need(false); }
  // All four implementation/test pairs and the three corresponding integration
  // tests are mandatory. No app, SQL, dependency, documentation, previous
  // attendance repair implementation or unrelated support path is admitted.
  need(Array.isArray(r.changedToolFiles) &&
    r.changedToolFiles.length === CONTACT_WECHAT_STAGED_REPAIR_FILES.length &&
    new Set(r.changedToolFiles).size === r.changedToolFiles.length &&
    r.changedToolFiles.every(file => CONTACT_WECHAT_STAGED_REPAIR_FILES.includes(file)) &&
    CONTACT_WECHAT_STAGED_REPAIR_FILES.every(file => r.changedToolFiles.includes(file)));
  need(typeof r.preparedAt === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(r.preparedAt) &&
    Number.isFinite(Date.parse(r.preparedAt)) && new Date(r.preparedAt).toISOString() === r.preparedAt);
  return r;
}
