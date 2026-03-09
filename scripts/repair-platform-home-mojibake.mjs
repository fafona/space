import fs from "node:fs/promises";

function readEnvValue(source, key) {
  const normalizedSource = source.replace(/^\uFEFF/, "");
  const matched = normalizedSource.match(new RegExp(`^${key}=(.+)$`, "m"));
  return matched?.[1]?.trim() ?? "";
}

function isQuestionOnly(value) {
  return typeof value === "string" && /^\?+(?:\s+\?+)*$/.test(value);
}

function isCorruptedUiText(value) {
  return typeof value === "string" && /^[?\s\d/._-]+$/.test(value) && value.includes("?");
}

function repairNavBlock(block, pageNamesById) {
  if (!block || block.type !== "nav" || !block.props) return block;
  const next = structuredClone(block);
  if (isQuestionOnly(next.props.heading)) next.props.heading = "\u9875\u9762\u5bfc\u822a";
  if (Array.isArray(next.props.navItems)) {
    next.props.navItems = next.props.navItems.map((item, index) => {
      if (!item || typeof item !== "object" || !isQuestionOnly(item.label)) return item;
      return {
        ...item,
        label: pageNamesById.get(item.pageId) ?? `\u9875\u9762${index + 1}`,
      };
    });
  }
  return next;
}

function repairSearchBarBlock(block) {
  if (!block || block.type !== "search-bar" || !block.props) return block;
  const next = structuredClone(block);
  if (isCorruptedUiText(next.props.locateLabel)) next.props.locateLabel = "";
  if (isCorruptedUiText(next.props.actionLabel)) next.props.actionLabel = "";
  if (isCorruptedUiText(next.props.cityPlaceholder)) next.props.cityPlaceholder = "";
  if (isCorruptedUiText(next.props.searchPlaceholder)) next.props.searchPlaceholder = "";
  return next;
}

function repairMerchantListBlock(block) {
  if (!block || block.type !== "merchant-list" || !block.props) return block;
  const next = structuredClone(block);
  if (isQuestionOnly(next.props.emptyText)) next.props.emptyText = "";
  if (
    Array.isArray(next.props.industryTabs) &&
    next.props.industryTabs.some((item) => isQuestionOnly(item?.label) || isQuestionOnly(item?.industry))
  ) {
    next.props.industryTabs = [
      { id: "tab-recommended", label: "\u63a8\u8350", industry: "all" },
      { id: "tab-catering", label: "\u9910\u996e", industry: "\u9910\u996e" },
      { id: "tab-entertainment", label: "\u5a31\u4e50", industry: "\u5a31\u4e50" },
      { id: "tab-retail", label: "\u96f6\u552e", industry: "\u96f6\u552e" },
      { id: "tab-service", label: "\u670d\u52a1", industry: "\u670d\u52a1" },
    ];
    if (next.props.merchantCardIndustryStyles && next.props.merchantCardIndustryStyles["??"]) {
      const fallbackStyle = next.props.merchantCardIndustryStyles["??"];
      delete next.props.merchantCardIndustryStyles["??"];
      for (const key of ["\u9910\u996e", "\u5a31\u4e50", "\u96f6\u552e", "\u670d\u52a1"]) {
        if (!next.props.merchantCardIndustryStyles[key]) {
          next.props.merchantCardIndustryStyles[key] = fallbackStyle;
        }
      }
    }
  }
  return next;
}

function repairPagePlanConfig(config) {
  if (!config || !Array.isArray(config.plans)) return config;
  const next = structuredClone(config);
  next.plans = next.plans.map((plan, planIndex) => {
    const repairedPlan = structuredClone(plan);
    if (isCorruptedUiText(repairedPlan.name)) repairedPlan.name = `\u65b9\u6848${planIndex + 1}`;
    const pageNamesById = new Map();
    repairedPlan.pages = (repairedPlan.pages ?? []).map((page, pageIndex) => {
      const nextPage = structuredClone(page);
      const fallbackName = pageIndex === 0 ? "\u9996\u9875" : `\u9875\u9762${pageIndex + 1}`;
      if (isCorruptedUiText(nextPage.name)) nextPage.name = fallbackName;
      pageNamesById.set(nextPage.id, nextPage.name);
      return nextPage;
    });
    repairedPlan.pages = repairedPlan.pages.map((page) => ({
      ...page,
      blocks: (page.blocks ?? []).map((block) =>
        repairMerchantListBlock(repairSearchBarBlock(repairNavBlock(block, pageNamesById))),
      ),
    }));
    repairedPlan.blocks = (repairedPlan.blocks ?? []).map((block) =>
      repairMerchantListBlock(repairSearchBarBlock(repairNavBlock(block, pageNamesById))),
    );
    return repairedPlan;
  });
  return next;
}

function repairBlocks(blocks) {
  const planMeta = blocks.find((block) => block?.id === "__plan_meta__" && block?.type === "common");
  const repairedPlanConfig = repairPagePlanConfig(planMeta?.props?.pagePlanConfig ?? null);
  const pageNamesById = new Map();
  for (const plan of repairedPlanConfig?.plans ?? []) {
    for (const page of plan.pages ?? []) {
      pageNamesById.set(page.id, page.name);
    }
  }

  return blocks.map((block) => {
    let next = structuredClone(block);
    if (next?.id === "__plan_meta__" && next?.type === "common" && next?.props?.pagePlanConfig) {
      next = {
        ...next,
        props: {
          ...next.props,
          pagePlanConfig: repairedPlanConfig,
          pagePlanConfigMobile: repairPagePlanConfig(next.props.pagePlanConfigMobile ?? null),
        },
      };
    }
    next = repairNavBlock(next, pageNamesById);
    next = repairSearchBarBlock(next);
    next = repairMerchantListBlock(next);
    return next;
  });
}

async function main() {
  const envSource = await fs.readFile(".env.local", "utf8");
  const supabaseUrl = readEnvValue(envSource, "NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = readEnvValue(envSource, "SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) throw new Error("missing Supabase env");

  const headers = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
  };
  const selectUrl = `${supabaseUrl}/rest/v1/pages?select=id,blocks&merchant_id=is.null&slug=eq.home&limit=1`;
  const pageResp = await fetch(selectUrl, { headers });
  if (!pageResp.ok) throw new Error(`failed to load page: ${pageResp.status} ${pageResp.statusText}`);
  const pages = await pageResp.json();
  const page = pages[0];
  if (!page?.id || !Array.isArray(page.blocks)) throw new Error("platform home page not found");

  const repairedBlocks = repairBlocks(page.blocks);
  const patchResp = await fetch(`${supabaseUrl}/rest/v1/pages?id=eq.${page.id}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ blocks: repairedBlocks }),
  });
  if (!patchResp.ok) throw new Error(`failed to patch page: ${patchResp.status} ${patchResp.statusText}`);

  const beforeQuestions = JSON.stringify(page.blocks).match(/\?/g)?.length ?? 0;
  const afterQuestions = JSON.stringify(repairedBlocks).match(/\?/g)?.length ?? 0;
  console.log(
    `[repair-platform-home-mojibake] page=${page.id} questions_before=${beforeQuestions} questions_after=${afterQuestions}`,
  );
}

main().catch((error) => {
  console.error(`[repair-platform-home-mojibake] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
