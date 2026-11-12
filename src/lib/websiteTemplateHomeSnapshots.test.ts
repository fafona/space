import test from 'node:test';
import assert from 'node:assert/strict';
import { getWebsiteTemplateHomeSnapshot, isTemplateHomeSnapshotSize, type WebsiteTemplateHomeSnapshots } from './websiteTemplateHomeSnapshots';
const revision = '22222222-2222-4222-8222-222222222222';
const snapshots: WebsiteTemplateHomeSnapshots = { revision, desktop: { imageUrl: 'data:image/webp;base64,UklGRg==', width: 1200, height: 7200 }, mobile: { imageUrl: 'data:image/webp;base64,UklGRg==', width: 390, height: 12000 } };
test('chooses the full desktop/mobile snapshot for this exact revision without touching the template', () => {
    const template = { revision, homeSnapshots: structuredClone(snapshots) }, before = structuredClone(template);
    assert.equal(getWebsiteTemplateHomeSnapshot(template, false), template.homeSnapshots.desktop);
    assert.equal(getWebsiteTemplateHomeSnapshot(template, true), template.homeSnapshots.mobile);
    assert.deepEqual(template, before);
});
test('never presents a cover, stale revision, remote URL, SVG, oversized or invalid geometry as a full homepage', () => {
    assert.equal(getWebsiteTemplateHomeSnapshot({ revision }, false), null);
    assert.equal(getWebsiteTemplateHomeSnapshot({ revision: 'other', homeSnapshots: snapshots }, false), null);
    for (const patch of [{ imageUrl: 'https://example.com/tracker.webp' }, { imageUrl: 'data:image/svg+xml;base64,YQ==' }, { width: 0 }, { height: 50001 }, { width: 4000, height: 50000 }, { imageUrl: 'data:image/webp;base64,' + 'A'.repeat(2_700_000) }]) {
        const changed = structuredClone(snapshots); Object.assign(changed.desktop, patch);
        assert.equal(getWebsiteTemplateHomeSnapshot({ revision, homeSnapshots: changed }, false), null);
    }
    assert.equal(isTemplateHomeSnapshotSize(1440, 6000), true);
    assert.equal(isTemplateHomeSnapshotSize(390, 12000), true);
});
