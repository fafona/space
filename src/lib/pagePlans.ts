import { homeBlocks, type Block } from "@/data/homeBlocks";

export const PLAN_IDS = ["plan-1", "plan-2", "plan-3"] as const;
export const PLAN_META_BLOCK_ID = "__plan_meta__";
export type PlanId = (typeof PLAN_IDS)[number];

export type PlanPage = {
  id: string;
  name: string;
  blocks: Block[];
};

export type PagePlan = {
  id: PlanId;
  name: string;
  blocks: Block[];
  pages: PlanPage[];
  activePageId: string;
};

export type PagePlanConfig = {
  activePlanId: PlanId;
  plans: PagePlan[];
};

const DEFAULT_PLAN_NAMES: Record<PlanId, string> = {
  "plan-1": "方案一",
  "plan-2": "方案二",
  "plan-3": "方案三",
};

function makeDefaultPageId(index: number) {
  return `page-${index + 1}`;
}

function makeDefaultPageName(index: number) {
  return `页面${index + 1}`;
}

export function cloneBlocks(source: Block[]) {
  if (typeof structuredClone === "function") {
    return structuredClone(source) as Block[];
  }
  return JSON.parse(JSON.stringify(source)) as Block[];
}

function clonePlanPages(source: PlanPage[]): PlanPage[] {
  if (typeof structuredClone === "function") {
    return structuredClone(source) as PlanPage[];
  }
  return JSON.parse(JSON.stringify(source)) as PlanPage[];
}

function isPlanMetaBlock(block: Block | null | undefined) {
  return !!block && block.id === PLAN_META_BLOCK_ID;
}

function getPlanConfigCarrier(sourceBlocks: Block[]) {
  return sourceBlocks.find((block) => !!(block?.props as { pagePlanConfig?: unknown } | undefined)?.pagePlanConfig);
}

function stripPlanConfigFromBlocks(source: Block[]) {
  const cloned = cloneBlocks(source).filter((block) => !isPlanMetaBlock(block));
  for (const block of cloned) {
    if (!block?.props) continue;
    delete (block.props as { pagePlanConfig?: unknown }).pagePlanConfig;
    delete (block.props as { pagePlanConfigMobile?: unknown }).pagePlanConfigMobile;
  }
  return cloned;
}

function isValidPlanId(value: unknown): value is PlanId {
  return typeof value === "string" && (PLAN_IDS as readonly string[]).includes(value);
}

function normalizePlanBlocks(value: unknown, fallback: Block[]) {
  if (!Array.isArray(value)) return cloneBlocks(fallback);
  const candidate = value as Block[];
  if (candidate.length > 0 && !candidate[0]?.id) return cloneBlocks(fallback);
  return stripPlanConfigFromBlocks(candidate);
}

function normalizePageId(rawId: unknown, index: number) {
  if (typeof rawId === "string" && rawId.trim()) return rawId.trim();
  return makeDefaultPageId(index);
}

function normalizePlanPages(rawPages: unknown, fallbackBlocks: Block[]): PlanPage[] {
  if (!Array.isArray(rawPages)) {
    return [
      {
        id: makeDefaultPageId(0),
        name: makeDefaultPageName(0),
        blocks: cloneBlocks(fallbackBlocks),
      },
    ];
  }

  const usedIds = new Set<string>();
  const pages: PlanPage[] = [];
  for (let i = 0; i < rawPages.length; i += 1) {
    const raw = rawPages[i] as { id?: unknown; name?: unknown; blocks?: unknown } | undefined;
    const baseId = normalizePageId(raw?.id, i);
    const id = usedIds.has(baseId) ? `${baseId}-${i + 1}` : baseId;
    usedIds.add(id);
    pages.push({
      id,
      name: typeof raw?.name === "string" && raw.name.trim() ? raw.name.trim() : makeDefaultPageName(i),
      blocks: normalizePlanBlocks(raw?.blocks, fallbackBlocks),
    });
  }

  if (pages.length === 0) {
    return [
      {
        id: makeDefaultPageId(0),
        name: makeDefaultPageName(0),
        blocks: cloneBlocks(fallbackBlocks),
      },
    ];
  }
  return pages;
}

function syncPlanBlocksWithActivePage(plan: PagePlan): PagePlan {
  const pages = plan.pages.length > 0 ? plan.pages : normalizePlanPages([], plan.blocks);
  const activePage = pages.find((page) => page.id === plan.activePageId) ?? pages[0];
  return {
    ...plan,
    pages,
    activePageId: activePage.id,
    blocks: cloneBlocks(activePage.blocks),
  };
}

export function getPlanPages(plan: PagePlan): PlanPage[] {
  return clonePlanPages(syncPlanBlocksWithActivePage(plan).pages);
}

export function getBlocksForPage(plan: PagePlan, pageId: string): Block[] {
  const normalized = syncPlanBlocksWithActivePage(plan);
  const page = normalized.pages.find((item) => item.id === pageId) ?? normalized.pages.find((item) => item.id === normalized.activePageId) ?? normalized.pages[0];
  return cloneBlocks(page?.blocks ?? normalized.blocks);
}

export function setBlocksForPage(plan: PagePlan, pageId: string, blocks: Block[]): PagePlan {
  const normalized = syncPlanBlocksWithActivePage(plan);
  const exists = normalized.pages.some((item) => item.id === pageId);
  const nextPages = exists
    ? normalized.pages.map((item) => (item.id === pageId ? { ...item, blocks: cloneBlocks(blocks) } : item))
    : [
        ...normalized.pages,
        {
          id: pageId,
          name: `页面${normalized.pages.length + 1}`,
          blocks: cloneBlocks(blocks),
        },
      ];
  return syncPlanBlocksWithActivePage({
    ...normalized,
    pages: nextPages,
    activePageId: exists ? normalized.activePageId : pageId,
  });
}

export function appendPageToPlan(plan: PagePlan, pageName?: string): { plan: PagePlan; page: PlanPage } {
  const normalized = syncPlanBlocksWithActivePage(plan);
  const index = normalized.pages.length;
  const page: PlanPage = {
    id: `page-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: pageName?.trim() || makeDefaultPageName(index),
    blocks: cloneBlocks(normalized.blocks),
  };
  return {
    page,
    plan: syncPlanBlocksWithActivePage({
      ...normalized,
      pages: [...normalized.pages, page],
    }),
  };
}

export function removePageFromPlan(plan: PagePlan, pageId: string): { plan: PagePlan; nextPageId: string } {
  const normalized = syncPlanBlocksWithActivePage(plan);
  const remaining = normalized.pages.filter((item) => item.id !== pageId);
  const safePages =
    remaining.length > 0
      ? remaining
      : [
          {
            id: makeDefaultPageId(0),
            name: makeDefaultPageName(0),
            blocks: cloneBlocks(normalized.blocks),
          },
        ];
  const nextPageId =
    normalized.activePageId === pageId
      ? safePages[0].id
      : safePages.find((item) => item.id === normalized.activePageId)?.id ?? safePages[0].id;
  return {
    nextPageId,
    plan: syncPlanBlocksWithActivePage({
      ...normalized,
      pages: safePages,
      activePageId: nextPageId,
    }),
  };
}

export function getPagePlanConfigFromBlocks(sourceBlocks: Block[]): PagePlanConfig {
  const cleanSource = stripPlanConfigFromBlocks(sourceBlocks.length > 0 ? sourceBlocks : homeBlocks);
  const carrier = getPlanConfigCarrier(sourceBlocks);
  const rawConfig = (carrier?.props as { pagePlanConfig?: unknown } | undefined)?.pagePlanConfig as
    | {
        activePlanId?: unknown;
        plans?: Array<{
          id?: unknown;
          name?: unknown;
          blocks?: unknown;
          pages?: unknown;
          activePageId?: unknown;
        }>;
      }
    | undefined;

  if (!rawConfig || !Array.isArray(rawConfig.plans)) {
    return {
      activePlanId: "plan-1",
      plans: PLAN_IDS.map((id) =>
        syncPlanBlocksWithActivePage({
          id,
          name: DEFAULT_PLAN_NAMES[id],
          blocks: cloneBlocks(cleanSource),
          pages: normalizePlanPages(undefined, cleanSource),
          activePageId: makeDefaultPageId(0),
        }),
      ),
    };
  }

  const plansById = new Map<PlanId, PagePlan>();
  for (const rawPlan of rawConfig.plans) {
    if (!isValidPlanId(rawPlan?.id)) continue;
    const rawBlocks = normalizePlanBlocks(rawPlan.blocks, cleanSource);
    const pages = normalizePlanPages(rawPlan.pages, rawBlocks);
    const activePageId =
      typeof rawPlan.activePageId === "string" && pages.some((page) => page.id === rawPlan.activePageId)
        ? rawPlan.activePageId
        : pages[0].id;
    plansById.set(
      rawPlan.id,
      syncPlanBlocksWithActivePage({
        id: rawPlan.id,
        name: typeof rawPlan.name === "string" ? rawPlan.name.trim() : DEFAULT_PLAN_NAMES[rawPlan.id],
        blocks: rawBlocks,
        pages,
        activePageId,
      }),
    );
  }

  const plans = PLAN_IDS.map((id) => {
    const plan = plansById.get(id);
    return plan
      ? syncPlanBlocksWithActivePage(plan)
      : syncPlanBlocksWithActivePage({
          id,
          name: DEFAULT_PLAN_NAMES[id],
          blocks: cloneBlocks(cleanSource),
          pages: normalizePlanPages(undefined, cleanSource),
          activePageId: makeDefaultPageId(0),
        });
  });

  const activePlanId = isValidPlanId(rawConfig.activePlanId) ? rawConfig.activePlanId : "plan-1";
  return { activePlanId, plans };
}

export function getActivePlanBlocks(sourceBlocks: Block[], pageId?: string) {
  const config = getPagePlanConfigFromBlocks(sourceBlocks);
  const activePlan = config.plans.find((plan) => plan.id === config.activePlanId) ?? config.plans[0];
  return getBlocksForPage(activePlan, pageId || activePlan.activePageId);
}

export function buildPersistedBlocksFromPlanConfig(config: PagePlanConfig) {
  const normalizedPlans = PLAN_IDS.map((id) => {
    const source = config.plans.find((item) => item.id === id);
    const fallbackPlan: PagePlan = {
      id,
      name: DEFAULT_PLAN_NAMES[id],
      blocks: cloneBlocks(homeBlocks),
      pages: normalizePlanPages(undefined, homeBlocks),
      activePageId: makeDefaultPageId(0),
    };
    const normalized = syncPlanBlocksWithActivePage(source ?? fallbackPlan);
    return {
      id,
      name: normalized.name.trim() || DEFAULT_PLAN_NAMES[id],
      blocks: stripPlanConfigFromBlocks(normalized.blocks),
      pages: normalized.pages.map((page, index) => ({
        id: page.id || makeDefaultPageId(index),
        name: page.name?.trim() || makeDefaultPageName(index),
        blocks: stripPlanConfigFromBlocks(page.blocks),
      })),
      activePageId: normalized.activePageId,
    };
  });

  const activePlan = normalizedPlans.find((plan) => plan.id === config.activePlanId) ?? normalizedPlans[0];
  const activePage = activePlan.pages.find((page) => page.id === activePlan.activePageId) ?? activePlan.pages[0];
  const activeBlocks = cloneBlocks(activePage?.blocks ?? activePlan.blocks);
  const next = cloneBlocks(activeBlocks);
  const metaBlock: Block = {
    id: PLAN_META_BLOCK_ID,
    type: "common",
    props: {
      commonTextBoxes: [],
      pagePlanConfig: {
        activePlanId: activePlan.id,
        plans: normalizedPlans,
      },
    } as never,
  };
  return [metaBlock, ...next];
}
