import { constants, promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isTemplateHomeSnapshotSize, MAX_TEMPLATE_HOME_SNAPSHOT_BYTES, type WebsiteTemplateHomeSnapshots } from './websiteTemplateHomeSnapshots';

export const WEBSITE_TEMPLATE_HOME_SNAPSHOT_ROOT = '/var/lib/faolla-template-home-snapshots';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA = /^[a-f0-9]{64}$/;
type ImageManifest = { file: string; width: number; height: number; bytes: number; sha256: string };
type Manifest = { schemaVersion: number; id: string; revision: string; sourceDesignHash: string; desktop: ImageManifest; mobile: ImageManifest };

async function readBounded(file: string, maximum: number): Promise<Buffer> {
    const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.nlink !== 1 || stat.size > maximum || stat.size < 1) throw Error('invalid_snapshot_file');
        const result = Buffer.alloc(Math.min(maximum + 1, stat.size + 1));
        let length = 0;
        while (length < result.length) {
            const read = await handle.read(result, length, result.length - length, length);
            if (!read.bytesRead) break;
            length += read.bytesRead;
        }
        if (length !== stat.size || length > maximum) throw Error('snapshot_changed');
        return result.subarray(0, length);
    } finally { await handle.close(); }
}

/** Read-only optional artwork. Missing, stale or invalid assets never break the catalog. */
export async function readWebsiteTemplateHomeSnapshots(id: string, revision: string, root = WEBSITE_TEMPLATE_HOME_SNAPSHOT_ROOT): Promise<WebsiteTemplateHomeSnapshots | undefined> {
    if (!UUID.test(id) || !UUID.test(revision)) return undefined;
    try {
        for (const directory of [root, path.join(root, id), path.join(root, id, revision)]) {
            const stat = await fs.lstat(directory);
            if (!stat.isDirectory() || stat.isSymbolicLink()) return undefined;
        }
        const directory = path.join(root, id, revision);
        const manifest = JSON.parse((await readBounded(path.join(directory, 'manifest.json'), 4096)).toString('utf8')) as Manifest;
        if (manifest.schemaVersion !== 1 || manifest.id !== id || manifest.revision !== revision || !SHA.test(manifest.sourceDesignHash)) return undefined;
        const images = await Promise.all((['desktop', 'mobile'] as const).map(async viewport => {
            const expected = manifest[viewport];
            if (!expected || expected.file !== viewport + '.webp' || !isTemplateHomeSnapshotSize(expected.width, expected.height) ||
                !Number.isInteger(expected.bytes) || expected.bytes < 12 || expected.bytes > MAX_TEMPLATE_HOME_SNAPSHOT_BYTES || !SHA.test(expected.sha256)) throw Error('invalid_snapshot_manifest');
            const bytes = await readBounded(path.join(directory, viewport + '.webp'), MAX_TEMPLATE_HOME_SNAPSHOT_BYTES);
            if (bytes.length !== expected.bytes || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP' ||
                createHash('sha256').update(bytes).digest('hex') !== expected.sha256) throw Error('snapshot_integrity');
            return [viewport, { imageUrl: 'data:image/webp;base64,' + bytes.toString('base64'), width: expected.width, height: expected.height }] as const;
        }));
        return { revision, ...Object.fromEntries(images) } as WebsiteTemplateHomeSnapshots;
    } catch { return undefined; }
}
