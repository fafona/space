import type { WebsiteTemplateDesign } from "@/lib/websiteTemplateLibrary";
const MAX_ASSET = 4000000;
const MAX_TOTAL = 12000000;
/** Embed raster assets so deleting/replacing a source merchant's uploads cannot alter a template or its copies. */
export async function freezeWebsiteTemplateAssets(design: WebsiteTemplateDesign, origins: string[], fetcher: typeof fetch = fetch) {
    const allowed = new Set(origins.filter(Boolean).map(v => new URL(v).origin));
    const cache = new Map<string, string>();
    let total = 0;
    const account = (value: string) => {
        if (!cache.has(value)) {
            total += Buffer.byteLength(value);
            if (total > MAX_TOTAL)
                throw new Error('template_assets_too_large');
            cache.set(value, value);
        }
        return value;
    };
    async function freeze(value: unknown, assetField = false): Promise<unknown> {
        if (Array.isArray(value)) {
            const out = [];
            for (const item of value)
                out.push(await freeze(item, assetField));
            return out;
        }
        if (value && typeof value === 'object') {
            const out: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(value))
                out[k] = await freeze(v, /^(?:bgImageUrl|pageBgImageUrl|images|url|src|audioUrl)$/i.test(k));
            return out;
        }
        if (typeof value !== "string")
            return value;
        if (/^data:(?:image\/(?:png|jpeg|webp|gif|avif)|audio\/(?:mpeg|mp3|wav|ogg|webm));base64,/i.test(value)) {
            if (value.length > 6000000)
                throw new Error("template_asset_too_large");
            return account(value);
        }
        // Only URL-valued assets, not ordinary paragraphs, are fetched. Refuse mutable external/unsupported media.
        if (!/^(?:https?:\/\/|\/)/i.test(value)) {
            if (assetField && value)
                throw new Error('template_asset_format_not_supported');
            return value;
        }
        const url = new URL(value, origins[1] || origins[0]);
        const asset = assetField || /\.(?:png|jpe?g|webp|gif|avif)(?:$|\?)/i.test(url.href) || url.pathname.startsWith('/storage/v1/object/public/');
        if (!asset) {
            if (/\.(?:svg|mp3|mp4|webm|ogg)(?:$|\?)/i.test(url.href))
                throw new Error("template_asset_format_not_supported");
            return value;
        }
        if (cache.has(url.href))
            return cache.get(url.href)!;
        if (!allowed.has(url.origin) || url.username || url.password || url.protocol !== "https:")
            throw new Error("template_asset_origin_not_allowed");
        const response = await fetcher(url, { redirect: "error", signal: AbortSignal.timeout(12000) });
        const mime = (response.headers.get("content-type") ?? "").split(';')[0].trim();
        if (!response.ok || !/^(?:image\/(?:png|jpeg|webp|gif|avif)|audio\/(?:mpeg|mp3|wav|ogg|webm))$/.test(mime) || !response.body)
            throw new Error("template_asset_unavailable");
        if (Number(response.headers.get('content-length') ?? 0) > MAX_ASSET)
            throw new Error("template_asset_too_large");
        const chunks: Uint8Array[] = [];
        let bytes = 0;
        const reader = response.body.getReader();
        try {
            while (true) {
                const part = await reader.read();
                if (part.done)
                    break;
                bytes += part.value.length;
                if (bytes > MAX_ASSET || total + bytes > MAX_TOTAL)
                    throw new Error("template_assets_too_large");
                chunks.push(part.value);
            }
        }
        finally {
            await reader.cancel();
        }
        const encoded = `data:${mime};base64,${Buffer.concat(chunks).toString('base64')}`;
        account(encoded);
        cache.set(url.href, encoded);
        return encoded;
    }
    return await freeze(design) as WebsiteTemplateDesign;
}
