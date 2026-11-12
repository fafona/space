export type WebsiteTemplateHomeSnapshot = { imageUrl: string; width: number; height: number };
export type WebsiteTemplateHomeSnapshots = {
    revision: string;
    desktop: WebsiteTemplateHomeSnapshot;
    mobile: WebsiteTemplateHomeSnapshot;
};

export const MAX_TEMPLATE_HOME_SNAPSHOT_BYTES = 2_000_000;
export function isTemplateHomeSnapshotSize(width: unknown, height: unknown): boolean {
    return typeof width === 'number' && Number.isInteger(width) && width >= 240 && width <= 4000 &&
        typeof height === 'number' && Number.isInteger(height) && height >= 1 && height <= 50000 && width * height <= 80_000_000;
}

/** A full-page preview is bound to the exact selected revision, never a cover. */
export function getWebsiteTemplateHomeSnapshot(template: {
    revision: string;
    homeSnapshots?: WebsiteTemplateHomeSnapshots;
}, mobile: boolean): WebsiteTemplateHomeSnapshot | null {
    const snapshots = template.homeSnapshots;
    if (!snapshots || snapshots.revision !== template.revision) return null;
    const snapshot = snapshots[mobile ? 'mobile' : 'desktop'];
    if (!snapshot || !isTemplateHomeSnapshotSize(snapshot.width, snapshot.height) ||
        typeof snapshot.imageUrl !== 'string' || snapshot.imageUrl.length > Math.ceil(MAX_TEMPLATE_HOME_SNAPSHOT_BYTES * 4 / 3) + 30 ||
        !/^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/.test(snapshot.imageUrl)) return null;
    return snapshot;
}
