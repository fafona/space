import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const PAGE_BATCH_SIZE = 100;

function parseEnvFile(filePath) {
  const parsed = {};
  if (!fs.existsSync(filePath)) return parsed;
  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) parsed[key] = value;
  }
  return parsed;
}

function loadEnv(cwd) {
  return {
    ...parseEnvFile(path.join(cwd, ".env")),
    ...parseEnvFile(path.join(cwd, ".env.local")),
    ...process.env,
  };
}

function countInlineAssets(value) {
  const stats = {
    imageCount: 0,
    audioCount: 0,
    totalCount: 0,
  };
  const visit = (input) => {
    if (typeof input === "string") {
      if (/^data:image\//i.test(input)) {
        stats.imageCount += 1;
        stats.totalCount += 1;
        return;
      }
      if (/^data:audio\//i.test(input)) {
        stats.audioCount += 1;
        stats.totalCount += 1;
      }
      return;
    }
    if (Array.isArray(input)) {
      input.forEach(visit);
      return;
    }
    if (input && typeof input === "object") {
      Object.values(input).forEach(visit);
    }
  };
  visit(value);
  return stats;
}

async function fetchAllPages(supabase) {
  const pages = [];
  let from = 0;
  while (true) {
    const to = from + PAGE_BATCH_SIZE - 1;
    const { data, error } = await supabase
      .from("pages")
      .select("id,merchant_id,slug,updated_at,blocks")
      .range(from, to);
    if (error) {
      throw new Error(`failed_to_fetch_pages:${error.message}`);
    }
    if (!Array.isArray(data) || data.length === 0) break;
    pages.push(...data);
    if (data.length < PAGE_BATCH_SIZE) break;
    from += PAGE_BATCH_SIZE;
  }
  return pages;
}

async function main() {
  const env = loadEnv(process.cwd());
  const supabaseUrl = String(env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const serviceRoleKey = String(env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const pages = await fetchAllPages(supabase);
  let matched = 0;
  let totalImages = 0;
  let totalAudio = 0;

  console.log(`[inline-asset-audit] pages=${pages.length}`);
  for (const page of pages) {
    const stats = countInlineAssets(page.blocks);
    if (stats.totalCount === 0) continue;
    matched += 1;
    totalImages += stats.imageCount;
    totalAudio += stats.audioCount;
    console.log(
      `[inline-asset-audit] page=${page.id} slug=${page.slug ?? ""} merchant=${page.merchant_id ?? "platform"} updated_at=${page.updated_at ?? ""} images=${stats.imageCount} audio=${stats.audioCount}`,
    );
  }

  console.log(
    `[inline-asset-audit] done matched_pages=${matched} images=${totalImages} audio=${totalAudio}`,
  );
}

main().catch((error) => {
  console.error(`[inline-asset-audit] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
