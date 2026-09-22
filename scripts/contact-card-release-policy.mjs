// Deliberately narrow: this lane publishes server-rendered public card routes,
// not arbitrary application, authentication, schema, or background-job changes.
export const CONTACT_RELEASE_CONFIG = '/www/server/panel/vhost/nginx/proxy/www.faolla.com/faolla_contact_card_release.conf';
export const CONTACT_RELEASE_ROOT = '/var/lib/faolla-contact-card-release';
export function assertContactReleaseScope(files) {
  const allowed = new Set([
    'src/app/card/[card]/route.ts', 'src/app/card/[card]/contact/route.ts',
    'src/lib/merchantBusinessCardDestination.ts', 'src/lib/merchantBusinessCardWebsiteRoute.test.ts',
    'scripts/contact-card-release-policy.mjs', 'scripts/contact-card-release.mjs',
    'scripts/contact-card-release.test.mjs', 'scripts/production-maintenance-control.mjs',
    'scripts/deploy.production.sh', 'docs/contact-card-fast-release.md',
    'docs/business-card-website-short-route-fix-2026-09-22.md',
  ]);
  if (!files.length || files.some(file => !allowed.has(file))) throw new Error('contact_release_scope_rejected');
}
export function contactReleaseConfig(sha, baseline, port) {
  if (!/^[a-f0-9]{40}$/.test(sha) || !/^[a-f0-9]{40}$/.test(baseline) || port !== 3101) throw new Error('contact_release_config_invalid');
  const headers = `proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_http_version 1.1;
    proxy_cache off;
    proxy_hide_header Cache-Control;
    add_header Cache-Control "no-store, max-age=0" always;`;
  return `# Managed by contact-card-release.mjs. Baseline ${baseline}; candidate ${sha}.
location ^~ /card/ {
    proxy_pass http://127.0.0.1:${port};
    ${headers}
    proxy_connect_timeout 2s;
    proxy_read_timeout 30s;
    proxy_intercept_errors on;
    error_page 502 504 = @faolla_contact_card_previous;
    add_header X-Faolla-Card-Release "${sha}" always;
}
location @faolla_contact_card_previous {
    proxy_pass http://127.0.0.1:3000;
    ${headers}
    add_header X-Faolla-Card-Release "${baseline}" always;
}
`;
}
