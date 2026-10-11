// Separately approved 2026-10-11: contact-card save guidance only. The exact
// application slice and already-reviewed tooling closure do not widen any older
// release lane, grant database authority, or replace source/ownership guards.
export const CONTACT_WECHAT_RELEASE_LANE = 'contact-wechat-code-only';
export const CONTACT_WECHAT_RELEASE_BASELINE = 'a535a308e21f121e7cf410a6f7d84c974eb370a6';
export const CONTACT_WECHAT_APPROVED_TOOL_REVISION = '4e482a849bc9d8668d00b6da1895d09414fa5d34';
export const CONTACT_WECHAT_APPLICATION_FILES = Object.freeze([
  'src/app/card/[card]/route.ts',
  'src/lib/merchantBusinessCardWebsiteRoute.test.ts',
]);

// Independently read from Git objects for live a535a308..reviewed 4e482a84.
// These source-only attendance repairs may be carried forward unchanged; they
// must never be run as part of this no-database application publication.
export const CONTACT_WECHAT_APPROVED_SUPPORT_SHA256 = Object.freeze({
  'docs/attendance-staged-tool-repair-20261010.md': 'b2d809bd26399d132ed3a483e28814afdd38109a20e41160468eeec55dd7bbbb',
  'scripts/attendance-extension-metadata.mjs': 'b35ae0c36a4b44750a37b2511131ed41eda0f1096cf229fc74a98d9043d2ac5c',
  'scripts/attendance-extension-metadata.test.mjs': 'a1c77c6bb3734c31d7966f926328837af74f42df77d64ababdd2bc0bf1ace258',
  'scripts/attendance-production-052-compatibility.mjs': '0207475a968161d99d0552c93eb75aee49f12169a8f90559a17d33be48ab4a58',
  'scripts/attendance-production-052-compatibility.test.mjs': '039e39414154cfcf6a08020eb695c29ec429b823889ceed32c1d11f62461b026',
  'scripts/attendance-production-database-migrations.mjs': '3347190c3f28fafe1d76e178a4a455491ade73abf6d0895ad5b653b705610a5a',
  'scripts/attendance-production-database-migrations.test.mjs': '4eb7a82a23c4402240689dd1553f814e445e3bbd5731ad15d5fbdf0a75f07181',
  'scripts/attendance-production-multiphase-guards-native.mjs': 'bbf4f01eacf951c5bf67f62236d41543ffbef8bd5f08fe677a7314e9c2b0df6d',
  'scripts/attendance-production-multiphase-guards-native.test.mjs': '49ea3e09b17bfe4236f4ca3b27e06caca2b28e67e0c7cd1a8f98fa042bfea9b8',
  'scripts/attendance-staged-tool-repair-policy.mjs': 'bce5963dcb46aa3bd3cf2073dff71ffe6c26850188efffd3638be80b9d9bf360',
  'scripts/attendance-staged-tool-repair-policy.test.mjs': '51c317a29ad24f5414aa14b05f6f64e362ba1b492a7069d6d34b9242968a4137',
  'scripts/attendance-staged-tool-repair.mjs': '5e1f236123491388c0ee904c01a74989707585ada418a064c80f08c59e141dd2',
  'scripts/attendance-staged-tool-repair.test.mjs': 'ed043942b1202fc93093c27a7b1bf5353a427b898fb4d0722c190c176c32ab68',
  'scripts/online-unpublished-candidate.test.mjs': '7a83d1dc0eba176531e2475e1fa015fadb13c7e7a268e84bf03ac452c943ea12',
  'scripts/prepare-online-release-tool.mjs': '06f5a014a5230d6bb0346f5465922cb03f38ac8f36fa36f6f9721a0838d214af',
  'scripts/prepare-online-release-tool.test.mjs': 'a605074c01d5c1d7838198604160383868e8c8c3ad7f19f1a67d725d72f2cf77',
  'scripts/test-helpers/attendance-extension-metadata.mjs': 'ddb18dcdfbd1f441d00f2061a5b7cb7282e8409347a3a1aad605b987a6913e21',
});
export const CONTACT_WECHAT_APPROVED_SUPPORT_FILES = Object.freeze(Object.keys(CONTACT_WECHAT_APPROVED_SUPPORT_SHA256));
export const CONTACT_WECHAT_RELEASE_TOOL_FILES = Object.freeze([
  'scripts/contact-wechat-release-policy.mjs',
  'scripts/contact-wechat-release-policy.test.mjs',
  'scripts/contact-wechat-online-build.mjs',
  'scripts/contact-wechat-online-build.test.mjs',
  'scripts/contact-wechat-release-probe-transport.mjs',
  'scripts/contact-wechat-release-probe-transport.test.mjs',
  'scripts/online-traffic-release-policy.mjs',
  'scripts/online-traffic-release.mjs',
  'scripts/online-traffic-release.test.mjs',
  'scripts/online-traffic-publication-policy.mjs',
  'scripts/online-traffic-publication-policy.test.mjs',
  'scripts/customer-code-release-policy.test.mjs',
  'docs/contact-wechat-code-only-release-20261011.md',
]);
const allowed = new Set([
  ...CONTACT_WECHAT_APPLICATION_FILES,
  ...CONTACT_WECHAT_APPROVED_SUPPORT_FILES,
  ...CONTACT_WECHAT_RELEASE_TOOL_FILES,
]);
const fail = reason => { throw Error(`contact_wechat_code_only_${reason}`); };
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function hasContactWechatReleaseAnchor(files) {
  return Array.isArray(files) && CONTACT_WECHAT_APPLICATION_FILES.every(file => files.includes(file));
}
export function assertContactWechatReleaseScope(files) {
  if (!Array.isArray(files) || !hasContactWechatReleaseAnchor(files) ||
      new Set(files).size !== files.length || files.some(file => !allowed.has(file))) fail('scope_rejected');
}

// The controller supplies the exact baseline-to-target committed path inventory
// and SHA256 of these 17 candidate Git blobs before creating state/artifacts.
// Activation must repeat the proof on the same clean, commit-owned candidate.
export function assertContactWechatApprovedClosure({baseline, files, sourceSha256ByFile} = {}) {
  if (baseline !== CONTACT_WECHAT_RELEASE_BASELINE) fail('baseline_invalid');
  assertContactWechatReleaseScope(files);
  if (!record(sourceSha256ByFile) || Object.keys(sourceSha256ByFile).length !== CONTACT_WECHAT_APPROVED_SUPPORT_FILES.length ||
      CONTACT_WECHAT_APPROVED_SUPPORT_FILES.some(file => !files.includes(file) || !Object.hasOwn(sourceSha256ByFile, file) ||
        sourceSha256ByFile[file] !== CONTACT_WECHAT_APPROVED_SUPPORT_SHA256[file])) fail('approved_support_changed');
  return CONTACT_WECHAT_RELEASE_LANE;
}
