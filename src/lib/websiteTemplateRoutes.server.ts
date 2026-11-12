import { NextResponse } from 'next/server';
import { createServerSupabaseServiceClient } from '@/lib/superAdminServer';
import { isSuperAdminRequestAuthorized } from '@/lib/superAdminRequestAuth';
import { resolveMerchantSessionFromRequest } from '@/lib/serverMerchantSession';
import { isTrustedSameOriginMutationRequest } from '@/lib/requestMutationGuard';
import { loadStoredMerchantDraft, type MerchantDraftStoreClient } from '@/lib/merchantDraftStore';
import { snapshotWebsiteTemplate, WEBSITE_TEMPLATE_CATEGORIES } from '@/lib/websiteTemplateLibrary';
import { freezeWebsiteTemplateAssets } from '@/lib/websiteTemplateAssets.server';
import { listWebsiteTemplates, readWebsiteTemplate, createWebsiteTemplate, updateWebsiteTemplate, replaceWebsiteTemplateDesign, canInitializeWebsiteTemplateDraft } from '@/lib/websiteTemplateStore.server';
import type { PlanId } from '@/lib/pagePlans';
import { resolveCanonicalPortalOrigin } from '@/lib/canonicalPortalRequest';
import { readWebsiteTemplateHomeSnapshots } from '@/lib/websiteTemplateHomeSnapshots.server';
export const websiteTemplateDependencies = { createClient: createServerSupabaseServiceClient, isAdmin: isSuperAdminRequestAuthorized, merchantSession: resolveMerchantSessionFromRequest, trusted: isTrustedSameOriginMutationRequest, loadDraft: loadStoredMerchantDraft, freeze: freezeWebsiteTemplateAssets, list: listWebsiteTemplates, read: readWebsiteTemplate, create: createWebsiteTemplate, update: updateWebsiteTemplate, replaceDesign: replaceWebsiteTemplateDesign, canInitialize:canInitializeWebsiteTemplateDraft, homeSnapshots:readWebsiteTemplateHomeSnapshots };
type Dependencies = typeof websiteTemplateDependencies;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store', 'Vary': 'Cookie, x-merchant-access-token' } });
export async function websiteTemplateGet(request: Request, admin = false, deps: Dependencies = websiteTemplateDependencies) {
    const merchant=admin?null:await deps.merchantSession(request);
    if (!(admin ? await deps.isAdmin(request) : merchant))
        return json({ error: 'unauthorized' }, 401);
    const editorSiteId=new URL(request.url).searchParams.get('editorSiteId');
    if(editorSiteId&&(admin||!/^\d{8}$/.test(editorSiteId)||merchant?.merchantId!==editorSiteId))return json({error:'unauthorized'},403);
    const id = new URL(request.url).searchParams.get('id');
    if (id && !UUID.test(id))
        return json({ error: 'invalid_template_id' }, 400);
    const db = deps.createClient();
    if (!db)
        return json({ error: 'template_library_unavailable' }, 503);
    try {
        if(editorSiteId)return json({canInitializeDraft:await deps.canInitialize(db,editorSiteId)});
        if (id) {
            const template = await deps.read(db, id, admin);
            if (template && new URL(request.url).searchParams.get('homeSnapshot') === '1') {
                const homeSnapshots = await deps.homeSnapshots(template.id, template.revision).catch(() => undefined);
                return json({ template: { ...template, ...(homeSnapshots ? { homeSnapshots } : {}) } });
            }
            return template ? json({ template }) : json({ error: 'template_not_found' }, 404);
        }
        const params = new URL(request.url).searchParams;
        const offset = Number(params.get('offset') ?? 0);
        const search = (params.get('search') ?? '').trim();
        const category = params.get('category') ?? '全部';
        if (!Number.isInteger(offset) || offset < 0 || offset > 100000 || search.length > 80 || (category !== '全部' && !WEBSITE_TEMPLATE_CATEGORIES.includes(category as never)))
            return json({ error: 'invalid_template_filter' }, 400);
        const templates = await deps.list(db, admin, { offset, search, category });
        return json({ templates, nextOffset: templates.length === 24 ? offset + 24 : null });
    }
    catch {
        return json({ error: 'template_library_unavailable' }, 503);
    }
}
export async function websiteTemplatePost(request: Request, deps: Dependencies = websiteTemplateDependencies) {
    if (!deps.trusted(request))
        return json({ error: 'untrusted_origin' }, 403);
    if (!await deps.isAdmin(request))
        return json({ error: 'unauthorized' }, 401);
    if (Number(request.headers.get('content-length') ?? 0) > 16000)
        return json({ error: 'request_too_large' }, 413);
    let b: Record<string, unknown>;
    try {
        const reader = request.body?.getReader();
        if (!reader)
            return json({ error: 'invalid_json' }, 400);
        const chunks: Uint8Array[] = [];
        let bytes = 0;
        try {
            while (true) {
                const part = await reader.read();
                if (part.done)
                    break;
                bytes += part.value.length;
                if (bytes > 16000) {
                    await reader.cancel();
                    return json({ error: 'request_too_large' }, 413);
                }
                chunks.push(part.value);
            }
        }
        finally {
            reader.releaseLock();
        }
        b = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!b || typeof b !== 'object' || Array.isArray(b))
            throw Error();
    }
    catch {
        return json({ error: 'invalid_json' }, 400);
    }
    const db = deps.createClient();
    if (!db)
        return json({ error: 'template_library_unavailable' }, 503);
    try {
        if (b.action === 'capture' || b.action === 'recapture') {
            let existing: Awaited<ReturnType<typeof readWebsiteTemplate>> = null;
            if (b.action === 'recapture') {
                if (!UUID.test(String(b.id)) || !UUID.test(String(b.revision)))
                    return json({ error: 'invalid_template_id' }, 400);
                existing = await deps.read(db, String(b.id), true);
                if (!existing)
                    return json({ error: 'template_not_found' }, 404);
                if (existing.revision !== b.revision)
                    return json({ error: 'template_revision_conflict' }, 409);
                // Never accept a new source identity or arbitrary design from this request.
                b.sourceSiteId = existing.sourceSiteId;
                b.sourcePlanId = existing.sourcePlanId;
            }
            if (!/^\d{8}$/.test(String(b.sourceSiteId)) || !['plan-1', 'plan-2', 'plan-3'].includes(String(b.sourcePlanId)))
                return json({ error: 'invalid_template_source' }, 400);
            const draft = await deps.loadDraft(db as unknown as MerchantDraftStoreClient, String(b.sourceSiteId));
            if (!draft)
                return json({ error: 'source_draft_not_found' }, 404);
            const snapshot = snapshotWebsiteTemplate(draft.blocks, b.sourcePlanId as PlanId);
            const origin = new URL(request.url);
            const portal = new URL(resolveCanonicalPortalOrigin());
            const root = new URL(portal.origin);
            root.hostname = root.hostname.replace(/^(?:launch|www)\./, '');
            const design = await deps.freeze(snapshot, [process.env.NEXT_PUBLIC_SUPABASE_URL ?? '', root.origin, portal.origin, origin.origin]);
            if (Buffer.byteLength(JSON.stringify(design)) > 6000000)
                return json({ error: 'template_assets_too_large' }, 400);
            if (existing)
                return json({ template: await deps.replaceDesign(db, existing.id, existing.revision, design) });
            return json({ template: await deps.create(db, { name: String(b.name ?? ''), category: String(b.category ?? ''), sourceSiteId: String(b.sourceSiteId), sourcePlanId: String(b.sourcePlanId), design }) });
        }
        if (b.action === 'update' && UUID.test(String(b.id)) && UUID.test(String(b.revision)))
            return json({ template: await deps.update(db, String(b.id), String(b.revision), { name: String(b.name ?? ''), category: String(b.category ?? ''), status: String(b.status ?? ''), sortOrder: Number(b.sortOrder), reviewed: b.reviewed === true }) });
        return json({ error: 'invalid_template_action' }, 400);
    }
    catch (e) {
        const error = e instanceof Error ? e.message : 'template_save_failed';
        const known = /^(?:invalid_template|template_(?:requires|booking|review|asset|assets|revision|navigation|page_link)|duplicate_template)/.test(error);
        return json({ error: known ? error : 'template_save_failed' }, error === 'template_revision_conflict' ? 409 : known ? 400 : 503);
    }
}
