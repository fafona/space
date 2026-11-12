import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { readWebsiteTemplateHomeSnapshots } from './websiteTemplateHomeSnapshots.server';
const id = '11111111-1111-4111-8111-111111111111', revision = '22222222-2222-4222-8222-222222222222';
const bytes = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAkA4JaQAA3AA/v89WAAAAA==', 'base64');
async function fixture() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'faolla-home-snapshot-test-'));
    const directory = path.join(root, id, revision); await fs.mkdir(directory, { recursive: true });
    for (const view of ['desktop', 'mobile']) await fs.writeFile(path.join(directory, view + '.webp'), bytes);
    const image = (file: string, width: number) => ({ file, width, height: 7200, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    const manifest = { schemaVersion: 1, id, revision, sourceDesignHash: 'a'.repeat(64), desktop: image('desktop.webp', 1200), mobile: image('mobile.webp', 390) };
    const save = () => fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest)); await save();
    const cleanup = async () => { assert(path.resolve(root).startsWith(path.join(path.resolve(os.tmpdir()), 'faolla-home-snapshot-test-'))); await fs.rm(root, { recursive: true, force: true }); };
    return { root, directory, manifest, save, cleanup };
}
test('reads both sealed WebP snapshots for one revision, never modifies their files', async () => {
    const f = await fixture(); try {
        const before = await fs.readFile(path.join(f.directory, 'manifest.json'));
        const result = await readWebsiteTemplateHomeSnapshots(id, revision, f.root); assert(result);
        assert.equal(result.revision, revision); assert.equal(result.desktop.width, 1200); assert.equal(result.mobile.width, 390);
        assert.equal(result.desktop.imageUrl, 'data:image/webp;base64,' + bytes.toString('base64'));
        assert.deepEqual(await fs.readFile(path.join(f.directory, 'manifest.json')), before);
    } finally { await f.cleanup(); }
});
test('missing/stale/bad assets fail as optional artwork without throwing or returning partial snapshots', async () => {
    const f = await fixture(); try {
        assert.equal(await readWebsiteTemplateHomeSnapshots('../outside', revision, f.root), undefined);
        assert.equal(await readWebsiteTemplateHomeSnapshots(id, '../outside', f.root), undefined);
        assert.equal(await readWebsiteTemplateHomeSnapshots(id, '33333333-3333-4333-8333-333333333333', f.root), undefined);
        f.manifest.revision = 'other'; await f.save(); assert.equal(await readWebsiteTemplateHomeSnapshots(id, revision, f.root), undefined);
        f.manifest.revision = revision; f.manifest.desktop.file = '../mobile.webp'; await f.save(); assert.equal(await readWebsiteTemplateHomeSnapshots(id, revision, f.root), undefined);
        f.manifest.desktop.file = 'desktop.webp'; await f.save(); await fs.writeFile(path.join(f.directory, 'mobile.webp'), 'tampered');
        assert.equal(await readWebsiteTemplateHomeSnapshots(id, revision, f.root), undefined);
    } finally { await f.cleanup(); }
});
test('refuses oversized files, hard-linked files and linked directories', async () => {
    const f = await fixture(); try {
        await fs.writeFile(path.join(f.directory, 'mobile.webp'), Buffer.alloc(2_000_001));
        assert.equal(await readWebsiteTemplateHomeSnapshots(id, revision, f.root), undefined);
        await fs.unlink(path.join(f.directory, 'mobile.webp'));
        await fs.link(path.join(f.directory, 'desktop.webp'), path.join(f.directory, 'mobile.webp'));
        assert.equal(await readWebsiteTemplateHomeSnapshots(id, revision, f.root), undefined);
        const linked = path.join(f.root, '33333333-3333-4333-8333-333333333333');
        await fs.symlink(path.join(f.root, id), linked, 'junction');
        assert.equal(await readWebsiteTemplateHomeSnapshots('33333333-3333-4333-8333-333333333333', revision, f.root), undefined);
    } finally { await f.cleanup(); }
});
