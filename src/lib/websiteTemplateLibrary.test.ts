import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { snapshotWebsiteTemplate, installWebsiteTemplate, validateWebsiteTemplateDesign, type WebsiteTemplateDesign } from './websiteTemplateLibrary';
import { buildCombinedPersistedBlocks } from './planTemplateRuntime';
import { type PagePlanConfig, type PlanId } from './pagePlans';
import type { Block } from '@/data/homeBlocks';
function config(): PagePlanConfig { return { activePlanId: 'plan-1', plans: ([1, 2, 3] as const).map(i => ({ id: ('plan-' + i) as PlanId, name: '方案' + i, activePageId: 'page-a', blocks: [], pages: [{ id: 'page-a', name: '首页', blocks: [{ id: 'heading', type: 'text', props: { heading: 'Original', text: 'untouched' } }] }] })) }; }
function design(): WebsiteTemplateDesign { return { desktop: [{ id: 'home', name: '乐园首页', blocks: [{ id: 'new', type: 'text', props: { heading: 'New', text: 'Sample' } }] }], mobile: [{ id: 'home', name: '乐园首页', blocks: [{ id: 'new-mobile', type: 'text', props: { heading: 'Mobile', text: 'Sample' } }] }] }; }
test('applies only the selected plan on both viewports and preserves active/public plan selection', () => {
    const target = { desktop: config(), mobile: config() };
    const before = structuredClone(target);
    const d = design();
    const result = installWebsiteTemplate(d, target, 'plan-3');
    assert.deepEqual(target, before);
    for (const view of ['desktop', 'mobile'] as const) {
        assert.deepEqual(result[view].plans.slice(0, 2), target[view].plans.slice(0, 2));
        assert.equal(result[view].activePlanId, 'plan-1');
        assert.equal(result[view].plans[2].pages[0].name, '乐园首页');
        assert.equal(result[view].plans[2].activePageId, 'home');
    }
});
test('template changes, source changes and one user edits never mutate any other independent copy', () => { const target = { desktop: config(), mobile: config() }; const original = design(); const userA = installWebsiteTemplate(original, target, 'plan-1'); const userB = installWebsiteTemplate(original, target, 'plan-1'); const b = structuredClone(userB); original.desktop[0].blocks[0].props.bgColor = '#f00'; userA.desktop.plans[0].pages[0].blocks[0].props.bgColor = '#000'; target.mobile.plans[0].pages.length = 0; assert.deepEqual(userB, b); assert.equal(userA.desktop.plans[0].blocks[0].props.bgColor, undefined); });
test('source snapshot drops private datasets, original poll identity, reviews, catalog products and contact details', () => { const c = config(); c.plans[2].pages[0].blocks = [{ id: 'p', type: 'product', props: { products: [{ id: 'private-product', name: 'private', price: '2.00' }] } }, { id: 'poll', type: 'poll', props: { pollId: 'source-round', pollRoundHistory: [{ settings: { pollId: 'secret' } }] } }, { id: 'contact', type: 'contact', props: { heading: 'Contact', phone: 'secretphone', phones: ['secret'], address: 'secret', addresses: ['secret'], email: 'secret', instagram: 'secret' } }, { id: 'review', type: 'google-reviews', props: { googleReviewItems: [{ reviewerName: 'secret' }], googleReviewAccountName: 'secret', googleReviewUrl: 'https://private.test' } }, { id: 'list', type: 'merchant-list', props: { heading: 'Directory', publishedMerchantSnapshot: [{ email: 'secret' }] as never } }]; const blocks = buildCombinedPersistedBlocks(c, structuredClone(c)); const before = JSON.stringify(blocks); const snapshot = snapshotWebsiteTemplate(blocks, 'plan-3'); assert.equal(JSON.stringify(blocks), before); const json = JSON.stringify(snapshot); assert(!json.includes('secret')); assert(!json.includes('private-product')); assert(!json.includes('source-round')); assert(!json.includes('publishedMerchantSnapshot')); snapshot.desktop[0].name = 'changed'; assert.equal(JSON.stringify(blocks), before); });
test('poll copies get fresh identities but stay paired across PC and mobile', () => {
    const d = design();
    for (const view of ['desktop', 'mobile'] as const)
        d[view][0].blocks = [{ id: 'poll', type: 'poll', props: { heading: 'Example' } }];
    const target = { desktop: config(), mobile: config() };
    const a = installWebsiteTemplate(d, target, 'plan-3');
    const b = installWebsiteTemplate(d, target, 'plan-3');
    const id = (r: typeof a, view: 'desktop' | 'mobile') => (r[view].plans[2].pages[0].blocks[0].props as {
        pollId: string;
    }).pollId;
    assert(id(a, 'desktop'));
    assert.equal(id(a, 'desktop'), id(a, 'mobile'));
    assert.notEqual(id(a, 'desktop'), id(b, 'desktop'));
    assert.equal((d.desktop[0].blocks[0].props as {
        pollId?: string;
    }).pollId, undefined);
});
test('rejects broken navigation, duplicate pages, multiple booking blocks and unsupported block types', () => { const d = design(); d.desktop[0].blocks.push({ id: 'bad', type: 'button', props: { buttonJumpTarget: 'page:missing' } }); assert.throws(() => validateWebsiteTemplateDesign(d), /page_link/); d.desktop[0].blocks.pop(); d.desktop.push(structuredClone(d.desktop[0])); assert.throws(() => validateWebsiteTemplateDesign(d), /duplicate/); d.desktop.pop(); d.desktop[0].blocks = [{ id: 'b1', type: 'booking', props: {} }, { id: 'b2', type: 'booking', props: {} }]; assert.throws(() => validateWebsiteTemplateDesign(d), /booking_limit/); d.desktop[0].blocks = [{ id: 'x', type: 'html', props: {} } as unknown as Block]; assert.throws(() => validateWebsiteTemplateDesign(d), /invalid_template_block/); });
test('responsive block reordering cannot split a poll or pair it with another poll', () => {
    const d = design();
    const poll = (id: string): Block => ({ id, type: 'poll', props: { heading: id } });
    d.desktop[0].blocks = [poll('first'), poll('second')];
    d.mobile[0].blocks = [d.mobile[0].blocks[0], poll('second'), poll('first')];
    const result = installWebsiteTemplate(d, { desktop: config(), mobile: config() }, 'plan-3');
    const blocks = (view: 'desktop' | 'mobile') => result[view].plans[2].pages[0].blocks;
    const pollId = (view: 'desktop' | 'mobile', id: string) => {
        const block = blocks(view).find(b => b.id === id);
        assert(block?.type === 'poll');
        return block.props.pollId;
    };
    for (const id of ['first', 'second']) {
        assert.equal(pollId('desktop', id), pollId('mobile', id));
    }
    assert.notEqual(pollId('desktop', 'first'), pollId('desktop', 'second'));
});
test('capture requires both PC and mobile, without silently using an unrelated plan', () => { const c = config(); assert.throws(() => snapshotWebsiteTemplate(buildCombinedPersistedBlocks(c), 'plan-3'), /requires_desktop_and_mobile/); });
test('source, read-only merchant route and SQL grants preserve the library boundary', async () => { const merchant = await readFile(new URL('../app/api/website-templates/route.ts', import.meta.url), 'utf8'); assert.match(merchant, /export function GET/); assert.doesNotMatch(merchant, /export (?:async )?function (?:POST|PUT|PATCH|DELETE)/); const sql = await readFile(new URL('../../scripts/supabase-migrations/202611100214_website_template_library.sql', import.meta.url), 'utf8'); assert.match(sql, /enable row level security/); assert.match(sql, /revoke all .* from public, anon, authenticated/); assert.match(sql, /grant select, insert, update, delete .* to service_role/); assert.doesNotMatch(sql, /update public\.(?:pages|merchants)|delete from|drop table/i); });
test('editor integration retains recovery before server save and never publishes on apply', async () => { const text = await readFile(new URL('../app/admin/AdminClient.tsx', import.meta.url), 'utf8'); const apply = text.slice(text.indexOf('async function useWebsiteTemplate('), text.indexOf('function persistPlanTemplates(')); assert(apply.indexOf('saveLatestDraftSnapshot(backup') < apply.indexOf('"/api/merchant-draft"')); assert(apply.indexOf('if (!response.ok)') < apply.indexOf('applySnapshot(snapshot)')); assert.match(apply, /verifyWebsiteTemplateEditor/); assert.match(apply, /merchantPlanLimit/); assert.match(apply, /merchantPageLimit/); assert.doesNotMatch(apply, /publishToFrontend\(|\/api\/publish|savePlatformState/); assert.match(text, /templateLibrary", "1"/); assert.match(text, /openMerchantEditorInNewWindow\(true\)/); });
test('template source has an explicit cloud-save entry, preserving local save and publish paths', async () => {
    const text = await readFile(new URL('../app/admin/AdminClient.tsx', import.meta.url), 'utf8');
    const save = text.slice(text.indexOf('async function saveCloudDraftForTemplateCapture('), text.indexOf('async function useWebsiteTemplate('));
    assert.match(save, /getSiteIdFromStoreScope\(storeScope\)/);
    assert.match(save, /verifyWebsiteTemplateEditor/);
    assert.match(save, /saveLatestDraftSnapshot/);
    assert.match(save, /\/api\/merchant-draft/);
    assert.doesNotMatch(save, /\/api\/publish|savePlatformState|applyPersistedBlocksToEditor/);
    assert.match(text, /onClick=\{saveDraft\}/);
    assert.match(text, /保存云端草稿/);
});
