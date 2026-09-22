// User-approved live lane for this backwards-compatible presentation change.
// No schema, authentication, worker, dependency or arbitrary API modifications.
import { assertContactReleaseScope } from './contact-card-release-policy.mjs';
export const WEB_RELEASE_ROOT = '/var/lib/faolla-web-presentation-release';
export const WEB_RELEASE_MARKER = '/www/server/panel/vhost/nginx/proxy/www.faolla.com/faolla_web_release.conf';
export const WEB_RELEASE_PROXY = '/www/server/panel/vhost/nginx/proxy/www.faolla.com';
export function webReleaseRuntimeEnvironment(text) {
  const excluded = new Set(['NODE_APP_INSTANCE','NODE_CHANNEL_FD','NODE_CHANNEL_SERIALIZATION_MODE','NODE_UNIQUE_ID','PM2_USAGE']);
  return Object.fromEntries(text.split('\0').filter(Boolean).map(s=>{const i=s.indexOf('=');return[s.slice(0,i),s.slice(i+1)];}).filter(([k])=>/^[A-Z][A-Z0-9_]*$/.test(k)&&!excluded.has(k)));
}
export const WEB_RELEASE_FILES = [
  'e6718553d7a03bef1e991fe6b6898cab_www.faolla.com.conf',
  'no_store_entries_www.faolla.com.conf', 'faolla_contact_card_release.conf',
];
export function assertWebPresentationReleaseScope(files) {
  const allowed = new Set([
    'src/components/admin/BusinessCardQrTextControls.tsx', 'src/components/admin/MerchantBusinessCardManager.tsx',
    'src/lib/merchantBusinessCardQr.ts', 'src/lib/merchantBusinessCardQrText.test.ts',
    'src/lib/merchantBusinessCardQrText.ts', 'src/lib/merchantBusinessCardQrTextPaths.ts',
    'src/lib/merchantBusinessCards.ts', 'src/lib/merchantBusinessCardBackground.test.ts',
    'src/lib/platformAdminBackupValidation.ts', 'src/lib/platformAdminBackupValidation.test.ts',
    'src/lib/platformMerchantSnapshot.ts', 'src/lib/platformMerchantSnapshot.test.ts',
    'scripts/web-presentation-release-policy.mjs', 'scripts/web-presentation-release.mjs',
    'scripts/web-presentation-release.test.mjs', 'docs/web-presentation-live-release.md',
    'docs/business-card-background-text-position-2026-09-22.md',
  ]);
  if (!files.length) throw new Error('web_release_scope_empty');
  for (const file of files) if (!allowed.has(file)) assertContactReleaseScope([file]);
}
export function webPresentationProxy(original, name, sha) {
  if (!WEB_RELEASE_FILES.includes(name) || !/^[a-f0-9]{40}$/.test(sha)) throw new Error('web_proxy_identity_invalid');
  const port = name === 'faolla_contact_card_release.conf' ? 3101 : 3000;
  if (!original.includes(`proxy_pass http://127.0.0.1:${port};`) || original.includes('127.0.0.1:3102')) throw new Error('web_proxy_baseline_invalid');
  // Change only the observed app upstreams, never Supabase/OAuth or static routing.
  let next = original.replaceAll(`proxy_pass http://127.0.0.1:${port};`, 'proxy_pass http://127.0.0.1:3102;');
  if (port === 3101) next = next.replace(/add_header X-Faolla-Card-Release "[a-f0-9]{40}" always;/, `add_header X-Faolla-Card-Release "${sha}" always;`);
  return `# Live presentation release ${sha}; original retained privately.\n${next}`;
}
