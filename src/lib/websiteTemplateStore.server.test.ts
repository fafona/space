import assert from 'node:assert/strict';
import test from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { listWebsiteTemplates, readWebsiteTemplate, createWebsiteTemplate, updateWebsiteTemplate, replaceWebsiteTemplateDesign, canInitializeWebsiteTemplateDraft } from './websiteTemplateStore.server';
import type { WebsiteTemplateDesign } from './websiteTemplateLibrary';
const design: WebsiteTemplateDesign = { desktop: [{ id: 'p', name: 'Home', blocks: [] }], mobile: [{ id: 'p', name: 'Home', blocks: [] }] };
const row = { id: 'id', revision: 'revision', name: 'Park', category: '娱乐', status: 'published', sort_order: 0, design, cover_image_url: '', desktop_page_count: 1, mobile_page_count: 1, source_site_id: 'PRIVATE-SOURCE', source_plan_id: 'plan-3', updated_at: 'now' };
function fake(data: unknown, error: unknown = null, expectedTable='website_templates') {
    const calls: Array<[
        string,
        ...unknown[]
    ]> = [];
    const q: Record<string, unknown> = {};
    for (const key of ['select', 'eq', 'is', 'abortSignal', 'order', 'limit', 'range', 'ilike', 'insert', 'update'])
        q[key] = (...args: unknown[]) => { calls.push([key, ...args]); return q; };
    q.maybeSingle = async () => ({ data, error });
    q.single = async () => ({ data, error });
    q.then = (resolve: (v: unknown) => void) => Promise.resolve({ data, error }).then(resolve);
    return { db: { from: (table: string) => { assert.equal(table, expectedTable); return q; } } as unknown as SupabaseClient, calls };
}
test('merchant projection cannot return source metadata or any design in list cards', async () => { const f = fake([row]); const result = await listWebsiteTemplates(f.db); assert.equal(result.length, 1); assert(!JSON.stringify(result).includes('PRIVATE-SOURCE')); assert(!('design' in result[0])); assert(f.calls.some(c => c[0] === 'eq' && c[1] === 'status' && c[2] === 'published')); assert(!String(f.calls.find(c => c[0] === 'select')?.[1]).includes('design')); });
test('detail returns an isolated value copy and hides admin source information', async () => { const f = fake(row); const read = await readWebsiteTemplate(f.db, 'id'); assert(read); assert(!('sourceSiteId' in read)); read.design.desktop[0].name = 'changed'; assert.equal(row.design.desktop[0].name, 'Home'); assert(f.calls.some(c => c[0] === 'eq' && c[1] === 'status')); });
test('creation is draft-only and never writes a client-provided template identity or mutable object', async () => { const f = fake(row); await createWebsiteTemplate(f.db, { name: 'Park', category: '娱乐', sourceSiteId: '10000000', sourcePlanId: 'plan-3', design }); const inserted = f.calls.find(c => c[0] === 'insert')?.[1] as Record<string, unknown>; assert.equal(inserted.status, 'draft'); assert.notEqual(inserted.id, 'id'); assert.notEqual(inserted.design, design); assert.equal(inserted.source_site_id, '10000000'); });
test('metadata updates are compare-and-swap, never include design, and reject unreviewed publication', async () => { const f = fake(row); const patch = { name: 'Park', category: '娱乐', status: 'published', sortOrder: 2, reviewed: true }; await updateWebsiteTemplate(f.db, 'id', 'old-revision', patch); const update = f.calls.find(c => c[0] === 'update')?.[1] as Record<string, unknown>; assert(!('design' in update)); assert(f.calls.some(c => c[0] === 'eq' && c[1] === 'revision' && c[2] === 'old-revision')); await assert.rejects(() => updateWebsiteTemplate(f.db, 'id', 'rev', { ...patch, reviewed: false }), /review_required/); });
test('concurrent edits and database failures are not reported as success', async () => { await assert.rejects(() => updateWebsiteTemplate(fake(null).db, 'id', 'rev', { name: 'Park', category: '娱乐', status: 'draft', sortOrder: 0 }), /revision_conflict/); await assert.rejects(() => listWebsiteTemplates(fake(null, { message: 'private' }).db), /unavailable/); });
test('replacing a template design is a reviewed new draft, guarded by exact revision and isolated from its source', async () => {
    const f = fake(row);
    await replaceWebsiteTemplateDesign(f.db, 'id', 'old', design);
    const patch = f.calls.find(c => c[0] === 'update')?.[1] as Record<string, unknown>;
    assert.equal(patch.status, 'draft');
    assert.notEqual(patch.revision, 'old');
    assert.notEqual(patch.design, design);
    assert(!('source_site_id' in patch));
    assert(f.calls.some(c => c[0] === 'eq' && c[1] === 'revision' && c[2] === 'old'));
    await assert.rejects(() => replaceWebsiteTemplateDesign(fake(null).db, 'id', 'old', design), /revision_conflict/);
});
test('new-site probe requires authoritative empty draft and published queries, and never mistakes an outage for empty',async()=>{
 for(const [results,expected] of [[ [[],[]],true],[[[{id:'old-draft'}]],false],[[[],[{id:'public',slug:'park'}]],false],[[[],[{id:'legacy',slug:null}]],false],[[[],[{id:'records',slug:'__merchant_orders__:10000000'}]],true]] as Array<[unknown[],boolean]>){
  const queue=[...results];const db={from:(table:string)=>{assert(queue.length,'unexpected extra read');return fake(queue.shift(),null,'pages').db.from(table);}} as unknown as SupabaseClient;
  assert.equal(await canInitializeWebsiteTemplateDraft(db,'10000000'),expected);
 }
 await assert.rejects(()=>canInitializeWebsiteTemplateDraft(fake(null,{message:'outage'},'pages').db,'10000000'),/unavailable/);
});
