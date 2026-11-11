import assert from 'node:assert/strict';
import test from 'node:test';
import { freezeWebsiteTemplateAssets } from './websiteTemplateAssets.server';
import type { WebsiteTemplateDesign } from './websiteTemplateLibrary';
const design = (url: string): WebsiteTemplateDesign => ({ desktop: [{ id: 'home', name: 'Home', blocks: [{ id: 'hero', type: 'hero', props: { title: 'Hi', bgImageUrl: url } }] }], mobile: [{ id: 'home', name: 'Home', blocks: [{ id: 'hero', type: 'hero', props: { title: 'Hi', bgImageUrl: url } }] }] });
test('freezes shared image once, independent from original URL, and preserves its source input', async () => { const d = design('https://assets.example/storage/v1/object/public/images/one'); const before = structuredClone(d); let calls = 0; const frozen = await freezeWebsiteTemplateAssets(d, ['https://assets.example', 'https://launch.example'], async () => { calls++; return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } }); }); assert.equal(calls, 1); assert.equal(frozen.desktop[0].blocks[0].props.bgImageUrl, 'data:image/png;base64,AQID'); assert.equal(frozen.mobile[0].blocks[0].props.bgImageUrl, frozen.desktop[0].blocks[0].props.bgImageUrl); assert.deepEqual(d, before); });
test('refuses external origins, redirects and non-raster images instead of retaining mutable links', async () => { await assert.rejects(() => freezeWebsiteTemplateAssets(design('https://other.example/photo'), ['https://assets.example']), /origin_not_allowed/); await assert.rejects(() => freezeWebsiteTemplateAssets(design('https://assets.example/a'), ['https://assets.example'], async () => new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } })), /unavailable/); await assert.rejects(() => freezeWebsiteTemplateAssets(design('blob:https://assets.example/a'), ['https://assets.example']), /format_not_supported/); });
test('bounds both streamed and inline assets, and does not alter ordinary text URLs', async () => {
    await assert.rejects(() => freezeWebsiteTemplateAssets(design('data:image/png;base64,' + 'A'.repeat(6000000)), ['https://assets.example']), /too_large/);
    await assert.rejects(() => freezeWebsiteTemplateAssets(design('https://assets.example/a'), ['https://assets.example'], async () => new Response(new Uint8Array(4000001), { headers: { 'content-type': 'image/png' } })), /too_large/);
    const d = design('data:image/png;base64,AQID');
    d.desktop[0].blocks.push({ id: 'text', type: 'text', props: { heading: 'Link', text: 'https://help.example/guide' } });
    const result = await freezeWebsiteTemplateAssets(d, ['https://assets.example']);
    assert.equal((result.desktop[0].blocks[1].props as {
        text: string;
    }).text, 'https://help.example/guide');
});
