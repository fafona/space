import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const PAGE_BATCH_SIZE = 100;
const BUCKET_CANDIDATES = ["page-assets", "assets", "uploads", "public"];

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

function estimateUtf8Size(value) {
  return Buffer.byteLength(String(value ?? ""), "utf8");
}

function parseMediaDataUrlMeta(dataUrl) {
  const matched = String(dataUrl).match(/^data:((?:image|audio)\/[a-zA-Z0-9.+-]+);base64,/i);
  if (!matched) return null;
  const mime = matched[1].toLowerCase();
  const extension = (() => {
    if (mime === "image/jpeg") return "jpg";
    if (mime === "image/png") return "png";
    if (mime === "image/webp") return "webp";
    if (mime === "image/gif") return "gif";
    if (mime === "image/bmp") return "bmp";
    if (mime === "image/svg+xml") return "svg";
    if (mime === "audio/mpeg") return "mp3";
    if (mime === "audio/mp3") return "mp3";
    if (mime === "audio/wav" || mime === "audio/x-wav") return "wav";
    if (mime === "audio/ogg") return "ogg";
    if (mime === "audio/aac") return "aac";
    if (mime === "audio/webm") return "webm";
    if (mime === "audio/mp4") return "m4a";
    return "img";
  })();
  return { mime, extension };
}

function dataUrlToBuffer(dataUrl) {
  const base64 = String(dataUrl).split(",")[1] ?? "";
  return Buffer.from(base64, "base64");
}

async function resolveUploadBucket(supabase) {
  const { data, error } = await supabase.storage.listBuckets();
  if (error) {
    throw new Error(`failed_to_list_storage_buckets:${error.message}`);
  }
  for (const bucket of BUCKET_CANDIDATES) {
    if (data.some((item) => item.name === bucket)) return bucket;
  }
  throw new Error(`no_supported_bucket_found:${BUCKET_CANDIDATES.join(",")}`);
}

async function uploadMediaDataUrl(supabase, bucket, dataUrl, merchantHint, pageId) {
  const meta = parseMediaDataUrlMeta(dataUrl);
  if (!meta) return null;
  const now = new Date();
  const yyyy = `${now.getFullYear()}`;
  const mm = `${now.getMonth() + 1}`.padStart(2, "0");
  const objectPath =
    `merchant-assets/${merchantHint}/${yyyy}/${mm}/${pageId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${meta.extension}`;
  const payload = dataUrlToBuffer(dataUrl);
  const uploaded = await supabase.storage.from(bucket).upload(objectPath, payload, {
    contentType: meta.mime,
    upsert: false,
  });
  if (uploaded.error) {
    throw new Error(`storage_upload_failed:${uploaded.error.message}`);
  }
  const { data } = supabase.storage.from(bucket).getPublicUrl(objectPath);
  if (!data?.publicUrl) {
    throw new Error("storage_public_url_missing");
  }
  return data.publicUrl;
}

async function externalizeInlineImages(value, context, stats) {
  if (typeof value === "string") {
    if (!/^data:(?:image|audio)\//i.test(value)) return value;
    stats.visited += 1;
    stats.beforeBytes += estimateUtf8Size(value);
    const next = await uploadMediaDataUrl(
      context.supabase,
      context.bucket,
      value,
      context.merchantHint,
      context.pageId,
    );
    if (!next) {
      stats.failed += 1;
      stats.afterBytes += estimateUtf8Size(value);
      return value;
    }
    stats.replaced += 1;
    stats.afterBytes += estimateUtf8Size(next);
    return next;
  }

  if (Array.isArray(value)) {
    const next = [];
    for (const item of value) {
      next.push(await externalizeInlineImages(item, context, stats));
    }
    return next;
  }

  if (value && typeof value === "object") {
    const next = {};
    for (const [key, child] of Object.entries(value)) {
      next[key] = await externalizeInlineImages(child, context, stats);
    }
    return next;
  }

  return value;
}

async function fetchAllPages(supabase) {
  const pages = [];
  let from = 0;
  while (true) {
    const to = from + PAGE_BATCH_SIZE - 1;
    const { data, error } = await supabase
      .from("pages")
      .select("id,merchant_id,slug,blocks")
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
  const cwd = process.cwd();
  const env = loadEnv(cwd);
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
  const bucket = await resolveUploadBucket(supabase);
  const pages = await fetchAllPages(supabase);

  console.log(`[inline-image-migrate] bucket=${bucket} pages=${pages.length}`);

  let changedPages = 0;
  let replacedImages = 0;
  let failedImages = 0;
  let beforeBytes = 0;
  let afterBytes = 0;

  for (const page of pages) {
    const blocks = Array.isArray(page.blocks) ? page.blocks : null;
    if (!blocks || blocks.length === 0) continue;

    const stats = {
      visited: 0,
      replaced: 0,
      failed: 0,
      beforeBytes: 0,
      afterBytes: 0,
    };
    const merchantHint = String(page.merchant_id ?? "").trim() || "platform";
    const nextBlocks = await externalizeInlineImages(blocks, {
      supabase,
      bucket,
      merchantHint,
      pageId: page.id,
    }, stats);

    if (stats.replaced === 0) continue;

    const { error } = await supabase
      .from("pages")
      .update({
        blocks: nextBlocks,
        updated_at: new Date().toISOString(),
      })
      .eq("id", page.id);
    if (error) {
      throw new Error(`failed_to_update_page:${page.id}:${error.message}`);
    }

    changedPages += 1;
    replacedImages += stats.replaced;
    failedImages += stats.failed;
    beforeBytes += stats.beforeBytes;
    afterBytes += stats.afterBytes;
    console.log(
      `[inline-image-migrate] updated page=${page.id} slug=${page.slug ?? ""} merchant=${merchantHint} images=${stats.replaced}/${stats.visited} bytes=${stats.beforeBytes}->${stats.afterBytes}`,
    );
  }

  console.log(
    `[inline-image-migrate] done changed_pages=${changedPages} replaced_images=${replacedImages} failed_images=${failedImages} bytes=${beforeBytes}->${afterBytes}`,
  );
}

main().catch((error) => {
  console.error(`[inline-image-migrate] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
