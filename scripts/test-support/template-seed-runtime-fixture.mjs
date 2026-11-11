// Named, network-free local/CI fixture. Never invokes a service client or seed.
import assert from 'node:assert/strict';
import {loadTemplateSeedRuntime} from '../application-release-template-seed.mjs';
const [server,drafts,design,assets,store]=await loadTemplateSeedRuntime(process.cwd());
for(const fn of [server.createServerSupabaseServiceClient,drafts.loadStoredMerchantDraft,design.snapshotWebsiteTemplate,design.getWebsiteTemplateCover,assets.freezeWebsiteTemplateAssets,store.updateWebsiteTemplate])assert.equal(typeof fn,'function');
console.log('template-seed-runtime-imports-passed');
