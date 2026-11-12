"use client";
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { WEBSITE_TEMPLATE_CATEGORIES, type WebsiteTemplate, type WebsiteTemplateCard } from '@/lib/websiteTemplateLibrary';
import type { PlanId } from '@/lib/pagePlans';
import { getWebsiteTemplateHomeSnapshot } from '@/lib/websiteTemplateHomeSnapshots';
const BUTTON = 'rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40';
const PREVIEW_BUTTON = 'whitespace-nowrap rounded-xl border border-slate-200 bg-white px-2 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 sm:px-4 sm:text-sm';
const INPUT = 'min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900';
type Props = {
    admin?: boolean;
    onClose?: () => void;
    onApply?: (template: WebsiteTemplate, target: PlanId) => Promise<void>;
    plans?: Array<{
        id: PlanId;
        name: string;
    }>;
    initialPlanId?: PlanId;
    request?: (url: string, init: RequestInit) => Promise<Response>;
};
const ERRORS: Record<string, string> = { unauthorized: '登录状态已失效，请重新登录。', template_library_unavailable: '模板库暂不可用，请检查服务端配置后重试。', template_revision_conflict: '模板已被其他管理员更新，请刷新后重试。', template_asset_origin_not_allowed: '模板含未获许可的外部图片，请先上传到平台再收录。', template_asset_unavailable: '部分图片无法读取，模板未保存，请检查后重试。', source_draft_not_found: '未找到来源草稿，请先在来源编辑器保存。', template_requires_desktop_and_mobile: '请先补齐电脑端和手机端设计。', template_booking_limit: '每套方案只能包含一个预约区块。', template_not_found: '模板已下架或不存在，请重新选择。' };
export default function WebsiteTemplateLibrary({ admin = false, onClose, onApply, plans = [], initialPlanId, request = fetch }: Props) {
    const [cards, setCards] = useState<WebsiteTemplateCard[]>([]);
    const [search, setSearch] = useState('');
    const [category, setCategory] = useState('全部');
    const [selected, setSelected] = useState<WebsiteTemplate | null>(null);
    const [mobile, setMobile] = useState(false);
    const [target, setTarget] = useState<PlanId>(plans.some(plan => plan.id === initialPlanId) ? initialPlanId! : plans[0]?.id ?? 'plan-1');
    const [busy, setBusy] = useState(false);
    const [loading, setLoading] = useState(true);
    const [notice, setNotice] = useState('');
    const dialog = useRef<HTMLDivElement>(null);
    const scrollArea = useRef<HTMLDivElement>(null);
    const catalogScrollTop = useRef(0);
    const alive = useRef(true);
    const loadGeneration = useRef(0);
    const [nextOffset, setNextOffset] = useState<number | null>(null);
    const appliedFilters = useRef({ search: '', category: '全部' });
    const closeRef = useRef(onClose);
    const busyRef = useRef(busy);
    closeRef.current = onClose;
    busyRef.current = busy;
    const endpoint = admin ? '/api/super-admin/website-templates' : '/api/website-templates';
    async function api(url: string, init: RequestInit = {}) {
        const response = await request(url, { credentials: 'same-origin', cache: 'no-store', ...init });
        const body = await response.json();
        if (!response.ok)
            throw new Error(ERRORS[body.error] ?? '操作未完成，请检查内容后重试。');
        return body;
    }
    async function load(more = false) {
        const generation = ++loadGeneration.current;
        setLoading(true);
        setNotice('');
        if (!more)
            appliedFilters.current = { search, category };
        const filters = appliedFilters.current;
        const query = new URLSearchParams({ search: filters.search, category: filters.category, offset: String(more ? (nextOffset ?? 0) : 0) });
        try {
            const body = await api(endpoint + '?' + query);
            if (alive.current && generation === loadGeneration.current) {
                setCards(prev => more ? Array.from(new Map([...prev, ...body.templates].map((card: WebsiteTemplateCard) => [card.id, card] as const)).values()) : body.templates);
                setNextOffset(body.nextOffset ?? null);
            }
        }
        catch (e) {
            if (alive.current && generation === loadGeneration.current)
                setNotice(e instanceof Error ? e.message : '读取失败');
        }
        finally {
            if (alive.current && generation === loadGeneration.current)
                setLoading(false);
        }
    }
    useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; loadGeneration.current++; }; }, []); // Fetch on entry only; never subscribe user designs to library changes.
    useLayoutEffect(() => {
        if (scrollArea.current) scrollArea.current.scrollTop = selected ? 0 : catalogScrollTop.current;
    }, [selected?.id, mobile]);
    useEffect(() => {
        if (!onClose)
            return;
        const before = document.activeElement as HTMLElement | null;
        const overflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        dialog.current?.focus();
        const key = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && !busyRef.current) {
                e.preventDefault();
                closeRef.current?.();
            }
            if (e.key === 'Tab') {
                const nodes = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),a[href],[tabindex="0"]') ?? []).filter(n => n.getClientRects().length);
                if (!nodes.length) {
                    e.preventDefault();
                    return;
                }
                if (e.shiftKey && document.activeElement === nodes[0]) {
                    e.preventDefault();
                    nodes.at(-1)?.focus();
                }
                else if (!e.shiftKey && document.activeElement === nodes.at(-1)) {
                    e.preventDefault();
                    nodes[0].focus();
                }
            }
        };
        document.addEventListener('keydown', key);
        return () => { document.removeEventListener('keydown', key); document.body.style.overflow = overflow; before?.focus(); };
    }, []);
    async function preview(card: WebsiteTemplateCard) {
        setBusy(true);
        setNotice('');
        try {
            const body = await api(endpoint + '?id=' + encodeURIComponent(card.id) + '&homeSnapshot=1');
            catalogScrollTop.current = scrollArea.current?.scrollTop ?? 0;
            setSelected(body.template);
            setMobile(false);
        }
        catch (e) {
            setNotice((e as Error).message);
        }
        finally {
            setBusy(false);
        }
    }
    async function mutate(body: unknown) { return api(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); }
    async function capture(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();
        const form = e.currentTarget;
        const f = new FormData(form);
        setBusy(true);
        setNotice('');
        try {
            await mutate({ action: 'capture', sourceSiteId: f.get('site'), sourcePlanId: f.get('plan'), name: f.get('name'), category: f.get('category') });
            await load();
            setNotice('已保存独立模板草稿。请预览检查后上架，用户暂不可见。');
            form.reset();
        }
        catch (e) {
            setNotice((e as Error).message);
        }
        finally {
            setBusy(false);
        }
    }
    async function update(e: FormEvent<HTMLFormElement>, card: WebsiteTemplateCard) {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const action = (e.nativeEvent as SubmitEvent).submitter?.getAttribute('value');
        const status = action === 'toggle' ? (card.status === 'published' ? 'draft' : 'published') : card.status;
        if (status === 'published' && !window.confirm('确认已检查电脑和手机页面，内容与图片可作为公开示例，不含真实客户、会员、订单或预约资料？上架后商户可以读取并复制；不会改动任何已套用的网站。'))
            return;
        setBusy(true);
        setNotice('');
        try {
            await mutate({ action: 'update', id: card.id, revision: card.revision, name: f.get('name'), category: f.get('category'), sortOrder: Number(f.get('sortOrder')), status, reviewed: status === 'published' });
            setSelected(null);
            await load();
            setNotice(status === 'published' ? '模板已上架。已套用的用户副本保持不变。' : '已保存模板草稿，商户不可读取。');
        }
        catch (e) {
            setNotice((e as Error).message);
        }
        finally {
            setBusy(false);
        }
    }
    async function recapture(card: WebsiteTemplateCard) {
        if (!window.confirm(`重新读取 ${card.sourceSiteId} 的 ${card.sourcePlanId?.replace('plan-', '方案')} 草稿，更新「${card.name}」的模板设计？新设计会转为草稿，重新审核上架；所有已套用的用户网站保持不变。`))
            return;
        setBusy(true);
        setNotice('');
        try {
            await mutate({ action: 'recapture', id: card.id, revision: card.revision });
            setSelected(null);
            await load();
            setNotice('模板设计已更新为待审核草稿，未改动任何用户副本。');
        }
        catch (e) {
            setNotice((e as Error).message);
        }
        finally {
            setBusy(false);
        }
    }
    const visible = cards.filter(c => (category === '全部' || c.category === category) && c.name.toLowerCase().includes(search.toLowerCase()));
    const previewHref = selected ? (admin ? '/super-admin/template-preview' : '/admin/template-preview') + '?' + new URLSearchParams({ id: selected.id, revision: selected.revision, viewport: mobile ? 'mobile' : 'desktop' }) : '';
    const homeSnapshot = selected ? getWebsiteTemplateHomeSnapshot(selected, mobile) : null;
    const applyControls = selected && !admin && onApply ? <div role="group" aria-label="复制模板到方案" className="flex min-w-0 flex-col items-center gap-1.5"><div className="flex max-w-full flex-wrap items-center justify-center gap-2"><span className="text-xs sm:text-sm">复制到</span><select aria-label="目标方案" className={INPUT + ' h-10 w-28 sm:w-32'} disabled={busy} value={target} onChange={e => setTarget(e.target.value as PlanId)}>{plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select><button className="rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-40 sm:px-5 sm:text-sm" disabled={busy || !plans.length} onClick={async () => {
                    setBusy(true);
                    setNotice('');
                    try {
                        await onApply(structuredClone(selected), target);
                    }
                    catch (e) {
                        setNotice((e as Error).message);
                    }
                    finally {
                        setBusy(false);
                    }
                }}>{busy ? '正在处理…' : '使用模板'}</button></div><span className="text-center text-[11px] leading-4 text-slate-500">仅替换所选方案 · 覆盖前确认并备份 · 不发布</span></div> : null;
    const shell = <div ref={dialog} tabIndex={-1} role={onClose ? 'dialog' : undefined} aria-modal={onClose ? true : undefined} aria-label={admin ? '模板管理' : '网站模板库'} className="flex h-full min-h-0 flex-col overflow-hidden rounded-3xl bg-[#f5f7fa] text-slate-900 shadow-xl outline-none">
  {selected ? <header data-template-preview-toolbar className="grid shrink-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-3 border-b bg-white px-3 py-3 sm:px-5 lg:grid-cols-[minmax(9rem,1fr)_auto_minmax(9rem,1fr)] lg:px-7">
    <button className={PREVIEW_BUTTON + ' col-start-1 row-start-1 justify-self-start'} disabled={busy} onClick={() => setSelected(null)}>← 返回模板库</button>
    <div className="col-span-2 col-start-1 row-start-2 min-w-0 lg:col-span-1 lg:col-start-2 lg:row-start-1">{applyControls ?? <div className="text-center text-sm font-semibold text-slate-600">模板设计预览</div>}</div>
    <div className="col-start-2 row-start-1 flex min-w-0 items-center justify-end gap-1.5 lg:col-start-3"><button className={PREVIEW_BUTTON} aria-pressed={!mobile} onClick={() => setMobile(false)}>电脑端</button><button className={PREVIEW_BUTTON} aria-pressed={mobile} onClick={() => setMobile(true)}>手机端</button>{onClose ? <button type="button" aria-label="关闭模板库" title="关闭模板库" className="h-9 w-8 shrink-0 rounded-lg border border-slate-200 bg-white text-xl text-slate-600 disabled:opacity-40" disabled={busy} onClick={onClose}>×</button> : null}</div>
    {notice ? <p role="status" className="col-span-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm lg:col-span-3">{notice}</p> : null}
  </header> : <header className="flex shrink-0 flex-wrap items-start justify-between gap-4 border-b bg-white px-5 py-5 sm:px-7"><div><div className="mb-1 text-xs font-semibold tracking-[0.18em] text-teal-700">FAOLLA · WEBSITE TEMPLATES</div><h2 className="text-2xl font-bold">{admin ? '模板管理' : '网站模板库'}</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">{admin ? '维护独立的官方模板快照。只有上架模板对商户可见，变更不会同步到已套用的网站。' : '选一套喜欢的设计，复制到自己的方案后自由编辑。模板更新不影响你的网站，使用模板也不会自动发布。'}</p></div><div className="flex gap-2"><button className={BUTTON} disabled={busy || loading} onClick={() => { setSelected(null); void load(); }}>刷新模板</button>{onClose ? <button className={BUTTON} disabled={busy} onClick={onClose}>关闭</button> : null}</div></header>}
  <div ref={scrollArea} data-template-library-scroll className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-7">
   {notice && !selected ? <p role="status" className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">{notice}</p> : null}
   {admin && selected ? <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border bg-white p-4"><span className="mr-auto text-sm text-slate-600">设计来源：{selected.sourceSiteId} · {selected.sourcePlanId?.replace('plan-', '方案')}。请先在来源编辑器点击“保存云端草稿”，再更新模板。</span><button type="button" className={BUTTON} disabled={busy} onClick={() => void recapture(selected)}>从来源更新设计</button></div> : null}
   {admin && !selected ? <form onSubmit={capture} className="mb-6 space-y-3 rounded-2xl border bg-white p-5"><h3 className="font-semibold">从已保存方案收录新模板</h3><p className="text-xs leading-5 text-slate-500">只读取指定方案的电脑／手机草稿；移除业务数据与投票身份，图片转为独立快照。已有模板和来源网站都不会被覆盖。</p><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><input required name="site" pattern="[0-9]{8}" placeholder="来源用户 ID，如 10000000" aria-label="来源用户 ID" className={INPUT}/><select name="plan" aria-label="来源方案" className={INPUT}>{[1, 2, 3].map(i => <option key={i} value={'plan-' + i}>方案{['一', '二', '三'][i - 1]}</option>)}</select><input required name="name" maxLength={100} aria-label="模板名称" placeholder="模板名称，如亲子游乐场" className={INPUT}/><select name="category" aria-label="模板行业" className={INPUT}>{WEBSITE_TEMPLATE_CATEGORIES.map(c => <option key={c}>{c}</option>)}</select><button disabled={busy} className={BUTTON}>收录为模板草稿</button></div></form> : null}
   {selected ? <div className="space-y-4"><h3 className="text-lg font-bold">{selected.name}</h3>
    <div className="grid gap-5 rounded-2xl border bg-white p-5 md:grid-cols-2">
      <figure data-template-home-snapshot={homeSnapshot ? 'full' : 'cover'} className="min-w-0 overflow-hidden rounded-xl bg-teal-50">{homeSnapshot ? <img src={homeSnapshot.imageUrl} alt={selected.name + ' · ' + (mobile ? '手机端' : '电脑端') + '完整首页快照'} width={homeSnapshot.width} height={homeSnapshot.height} className="mx-auto block h-auto w-full" style={{ maxWidth: mobile ? 430 : undefined }}/> : selected.coverImageUrl ? <img src={selected.coverImageUrl} alt={selected.name + '封面（非完整首页快照）'} className="block h-auto w-full"/> : <div className="p-8 text-center text-lg font-bold text-teal-900">{selected.name}</div>}<figcaption className="border-t border-teal-100 bg-white/90 px-3 py-2 text-xs leading-5 text-slate-500">{homeSnapshot ? (mobile ? '手机端' : '电脑端') + '完整首页快照 · 可向下滚动查看全部内容' : '当前仅有封面，完整首页快照尚未生成。可打开完整预览查看全部内容。'}</figcaption></figure>
      <div className="space-y-4"><h4 className="font-semibold">{mobile ? '手机端' : '电脑端'}包含的页面</h4><ol className="grid gap-2 text-sm text-slate-600">{selected.design[mobile ? 'mobile' : 'desktop'].map((page, index) => <li key={page.id}>{String(index + 1).padStart(2, '0')} · {page.name}</li>)}</ol>
        <a className={BUTTON + ' inline-block'} href={previewHref} target="_blank" rel="noopener noreferrer" onClick={event => { const opened = window.open(previewHref, '_blank', mobile ? 'popup,width=430,height=860' : 'popup,width=1280,height=900'); if (opened) {
            opened.opener = null;
            event.preventDefault();
        } }}>打开{mobile ? '手机端' : '电脑端'}完整预览 ↗</a>
        <p className="text-xs leading-5 text-slate-500">首页快照展示完整首页；独立预览可以浏览全部页面，不会改动编辑器。若浏览器限制窗口尺寸，可直接在手机上打开手机端预览。预览不提交预约、下单或投票。</p>
      </div>
    </div>
   </div> : <><form onSubmit={e => { e.preventDefault(); void load(); }} className="mb-5 flex flex-wrap gap-3"><input type="search" maxLength={80} aria-label="搜索模板" placeholder="搜索全部模板名称" value={search} onChange={e => setSearch(e.target.value)} className={INPUT + ' flex-1'}/><select aria-label="按行业筛选" value={category} onChange={e => setCategory(e.target.value)} className={INPUT}>{['全部', ...WEBSITE_TEMPLATE_CATEGORIES].map(c => <option key={c}>{c}</option>)}</select><button className={BUTTON} disabled={loading || busy}>搜索 / 筛选</button></form>
    {loading ? <div role="status" className="py-20 text-center text-slate-500">正在读取模板库…</div> : visible.length ? <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{visible.map(card => <article key={card.id + card.revision} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><button className="relative block aspect-[16/10] w-full overflow-hidden bg-gradient-to-br from-teal-50 to-orange-100" disabled={busy} onClick={() => void preview(card)} aria-label={'预览 ' + card.name}>{card.coverImageUrl ? <img src={card.coverImageUrl} alt="" className="h-full w-full object-cover"/> : <span className="text-xl font-bold text-teal-900">{card.name}</span>}<span className="absolute left-3 top-3 rounded-full bg-white/95 px-3 py-1 text-xs font-semibold">{card.category}</span></button><div className="space-y-3 p-5"><h3 className="text-lg font-bold">{card.name}</h3><div className="text-xs text-slate-500">电脑 {card.desktopPageCount} 页 · 手机 {card.mobilePageCount} 页 · 独立可编辑副本</div>{admin ? <form onSubmit={e => void update(e, card)} className="grid grid-cols-2 gap-2"><input name="name" aria-label="编辑模板名称" defaultValue={card.name} required maxLength={100} className={INPUT + ' col-span-2'}/><select name="category" aria-label="编辑行业" defaultValue={card.category} className={INPUT}>{WEBSITE_TEMPLATE_CATEGORIES.map(c => <option key={c}>{c}</option>)}</select><input type="number" name="sortOrder" min={-10000} max={10000} aria-label="排序权重（小的优先）" defaultValue={card.sortOrder} className={INPUT}/><button className={BUTTON} disabled={busy}>保存资料</button><button className={BUTTON} disabled={busy} value="toggle">{card.status === 'published' ? '下架模板' : '审核并上架'}</button><span className="col-span-2 text-xs text-slate-500">当前：{card.status === 'published' ? '已上架' : '草稿／未上架'}</span></form> : null}<button className={BUTTON + ' w-full'} disabled={busy} onClick={() => void preview(card)}>{admin ? '预览设计 →' : '预览'}</button></div></article>)}</div> : <div className="rounded-2xl border border-dashed bg-white py-20 text-center text-sm text-slate-500">{cards.length ? '没有匹配的模板，请调整筛选条件。' : admin ? '还没有模板，请从上方收录已保存的方案。' : '暂无已上架模板，请稍后再来。'}</div>}</>}
   {!selected && nextOffset !== null ? <div className="mt-6 text-center"><button type="button" className={BUTTON} disabled={busy || loading} onClick={() => void load(true)}>加载更多模板</button></div> : null}
  </div>
 </div>;
    return onClose ? <div data-editor-overlay className="fixed inset-0 z-[2147482600] bg-slate-950/45 p-2 backdrop-blur-sm sm:p-6">{shell}</div> : <div className="h-[calc(100dvh-150px)] min-h-[620px]">{shell}</div>;
}
