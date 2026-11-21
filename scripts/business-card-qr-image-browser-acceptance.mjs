import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import sharp from "sharp";
import { chromium } from "playwright";

// Real shared QR controls, normalizer, image decoder, preview and exporter.
// Synthetic draft persistence only; no merchant credentials, API calls or data.
test("QR center uploads and size sliders work in both card modes on desktop and mobile", { timeout: 120_000 }, async () => {
  const bundle = await build({ stdin: { contents: `import React,{useEffect,useState}from'react';import{createRoot}from'react-dom/client';
    import {BusinessCardQrControls}from'./src/components/admin/BusinessCardQrControls';
    import {useBusinessCardQrPreview}from'./src/components/admin/useBusinessCardQrPreview';
    import {createBlankMerchantBusinessCardDraft,normalizeMerchantBusinessCardDraft}from'./src/lib/merchantBusinessCards';
    function App(){const[draft,setDraft]=useState(()=>({...createBlankMerchantBusinessCardDraft(),mode:window.__mode,showQr:true}));
      const[busy,setBusy]=useState(false);const[error,setError]=useState('');
      const target=draft.mode==='image'?'https://shop.faolla.com/':'https://faolla.com/card/synthetic-card';
      const qr=useBusinessCardQrPreview(JSON.stringify([target,draft.qr]),true,'synthetic-card',setError);
      useEffect(()=>{window.__draft=draft;},[draft]);
      return <main style={{maxWidth:760,margin:'0 auto',padding:16}}><h1>名片二维码</h1>
        <label>名片模式<select aria-label="名片模式" value={draft.mode} onChange={e=>setDraft(d=>({...d,mode:e.target.value}))}><option value="image">图片模式</option><option value="link">链接模式</option></select></label>
        <button type="button" disabled={busy||!qr.currentUrl} onClick={()=>window.__saved=JSON.stringify(draft)}>保存名片</button>
        <button type="button" onClick={()=>setDraft(normalizeMerchantBusinessCardDraft(JSON.parse(window.__saved)))}>重新打开名片</button>
        {qr.display&&<img alt="二维码实时预览" src={qr.display.url} style={{width:220,height:'auto',display:'block',margin:'12px auto'}}/>}
        <BusinessCardQrControls {...draft.qr} targetUrl={target} onImageProcessingChange={setBusy}
          onChange={patch=>setDraft(d=>normalizeMerchantBusinessCardDraft({...d,qr:{...d.qr,...patch}}))}/>
        <p role="alert">{error}</p></main>}
    createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);`, loader: "tsx", resolveDir: process.cwd() },
    bundle: true, platform: "browser", format: "iife", write: false, logLevel: "silent", define: { "process.env": "{}" } });
  const css = (await postcss([tailwind()]).process('@import "tailwindcss" source(none);\n' + ["BusinessCardQrEditorControls", "BusinessCardQrImageControls", "BusinessCardQrPresetSelector", "BusinessCardQrTextControls", "ColorOrGradientPicker"].map(name => `@source "./src/components/admin/${name}.tsx";`).join("\n"), { from: path.resolve("qr-image-acceptance.css") })).css;
  const png = await sharp({ create: { width: 480, height: 120, channels: 4, background: "#146da5" } }).png().toBuffer();
  const jpeg = await sharp(png).jpeg().toBuffer();
  const webp = await sharp(png).webp().toBuffer();
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [1280, 390]) for (const mode of ["image", "link"]) {
      const context = await browser.newContext({ viewport: { width, height: 960 }, acceptDownloads: true });
      const page = await context.newPage(), errors = [], unexpected = [];
      page.on("pageerror", error => errors.push(error.message));
      await context.route("**/*", route => {
        const url = new URL(route.request().url());
        if (url.origin === "https://qr-upload.invalid" && route.request().isNavigationRequest()) return route.fulfill({ contentType: "text/html", body: '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>' });
        unexpected.push(url.toString()); return route.abort();
      });
      try {
        await page.goto("https://qr-upload.invalid/card");
        await page.evaluate(value => { window.__mode = value; }, mode);
        await page.addStyleTag({ content: css });
        await page.addScriptTag({ content: bundle.outputFiles[0].text });
        const input = page.getByLabel("上传二维码中心图片", { exact: true });
        const scale = page.getByRole("slider", { name: "中心图案大小", exact: true });
        const waitForScale = value => page.waitForFunction(expected => {
          const source = document.querySelector('img[alt="二维码实时预览"]')?.src;
          if (!source) return false;
          const svg = new DOMParser().parseFromString(decodeURIComponent(source.slice(source.indexOf(',') + 1)), 'image/svg+xml');
          const center = svg.querySelector('[data-qr-icon]');
          return !!center && Number(center.getAttribute('data-qr-icon-scale') ?? 100) === expected;
        }, value);
        const artworkWidth = () => page.evaluate(() => {
          const source = document.querySelector('img[alt="二维码实时预览"]').src;
          const svg = new DOMParser().parseFromString(decodeURIComponent(source.slice(source.indexOf(',') + 1)), 'image/svg+xml');
          return Number(svg.querySelector('[data-qr-icon] image').getAttribute('width'));
        });
        await input.waitFor({ state: "attached" });
        assert.equal(await scale.isDisabled(), true, "select a center before resizing it");
        await page.evaluate(() => {
          const original = Image.prototype.decode;
          let delayOnce = true;
          Image.prototype.decode = async function() {
            const delay = delayOnce && this.src.startsWith('blob:');
            if (delay) delayOnce = false;
            await original.call(this);
            if (delay) await new Promise(resolve => setTimeout(resolve, 800));
          };
        });
        await input.setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: png });
        assert.equal(await input.isDisabled(), true);
        assert.equal(await page.getByRole("button", { name: "保存名片", exact: true }).isDisabled(), true);
        assert.equal(await page.getByRole("button", { name: "导出二维码", exact: true }).isDisabled(), true);
        await page.getByAltText("已上传的二维码中心图片").waitFor();
        await page.waitForFunction(() => !Array.from(document.querySelectorAll('button')).find(button => button.textContent === '保存名片')?.disabled);
        const first = await page.evaluate(() => window.__draft.qr.iconImageDataUrl);
        assert.ok(first.startsWith("data:image/png;base64,"));
        const alpha = await page.evaluate(async () => {
          const img = new Image(); img.src = window.__draft.qr.iconImageDataUrl; await img.decode();
          const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
          const ctx = canvas.getContext('2d'); ctx.drawImage(img,0,0);
          return { width: img.width, height: img.height, corner: ctx.getImageData(0,0,1,1).data[3], middle: ctx.getImageData(64,64,1,1).data[3] };
        });
        assert.deepEqual(alpha, { width: 128, height: 128, corner: 0, middle: 255 });
        assert.equal(await scale.inputValue(), "130", "uploaded artwork defaults to a larger size");
        await waitForScale(130);
        const recommendedWidth = await artworkWidth();
        await scale.press("Home");
        await waitForScale(50);
        const smallWidth = await artworkWidth();
        assert.ok(smallWidth < recommendedWidth, `slider changes the actual preview artwork: ${smallWidth} < ${recommendedWidth}`);
        await page.getByRole("button", { name: "保存名片", exact: true }).click();
        await page.getByRole("button", { name: "重新打开名片", exact: true }).click();
        assert.equal(await scale.inputValue(), "50");
        await scale.press("End");
        await waitForScale(150);
        assert.ok(await artworkWidth() > recommendedWidth, "safe maximum is visibly larger than the recommendation");
        await page.getByRole("button", { name: "保存名片", exact: true }).click();
        assert.equal(await page.evaluate(() => JSON.parse(window.__saved).qr.iconScale), 150);
        await input.setInputFiles([]);
        assert.equal(await page.evaluate(() => window.__draft.qr.iconImageDataUrl), first, "picker cancellation must not discard a logo or close the editor");
        await input.setInputFiles({ name: "unsafe.svg", mimeType: "image/svg+xml", buffer: Buffer.from('<svg onload="alert(1)"/>') });
        await page.getByRole("status").filter({ hasText: "只支持 PNG" }).waitFor();
        assert.equal(await page.evaluate(() => window.__draft.qr.iconImageDataUrl), first);
        await page.getByRole("button", { name: "重新打开名片", exact: true }).click();
        assert.equal(await page.getByAltText("已上传的二维码中心图片").getAttribute("src"), first);
        assert.equal(await scale.inputValue(), "150");
        await waitForScale(150);
        for (const format of ["svg", "2048"]) {
          await page.getByLabel("二维码导出格式", { exact: true }).selectOption(format);
          const downloading = page.waitForEvent("download");
          await page.getByRole("button", { name: "导出二维码", exact: true }).click();
          const download = await downloading, bytes = await fs.readFile(await download.path());
          if (format === "svg") assert.match(bytes.toString(), /data-qr-icon="uploaded"/);
          else assert.equal((await sharp(bytes).metadata()).width, 2048);
          await page.getByText("已生成二维码文件。印刷前请用手机在实际尺寸下试扫。", { exact: true }).waitFor();
        }
        // Raster input types are all re-encoded, never embedded unchanged.
        for (const [name, mimeType, buffer] of [["photo.jpg", "image/jpeg", jpeg], ["photo.webp", "image/webp", webp]]) {
          await input.setInputFiles({ name, mimeType, buffer });
          await page.getByRole("status").filter({ hasText: "图片已加入二维码预览" }).waitFor();
          assert.ok((await page.evaluate(() => window.__draft.qr.iconImageDataUrl)).startsWith("data:image/png;base64,"));
          assert.equal(await scale.inputValue(), "150", "replacement keeps the user's size setting");
        }
        await page.getByRole("button", { name: "移除图片", exact: true }).click();
        assert.equal(await page.getByAltText("已上传的二维码中心图片").count(), 0);
        assert.equal(await scale.isDisabled(), true);
        await page.getByRole("button", { name: "重新打开名片", exact: true }).click();
        await page.getByRole("button", { name: /^图形 ·/ }).click();
        await page.getByRole("group", { name: "图形选项", exact: true }).getByRole("button", { name: "无图形", exact: true }).click();
        assert.equal(await page.evaluate(() => window.__draft.qr.iconImageDataUrl ?? ""), "");
        await page.getByLabel("搜索图形", { exact: true }).fill("coffee");
        await page.getByRole("group", { name: "图形选项", exact: true }).getByRole("button", { name: "咖啡", exact: true }).click();
        assert.equal(await page.evaluate(() => window.__draft.qr.icon), "coffee");
        assert.equal(await page.evaluate(() => window.__draft.qr.iconImageDataUrl ?? ""), "");
        await page.getByRole("button", { name: "收起", exact: true }).click();
        await scale.press("Home");
        await waitForScale(50);
        await page.getByRole("button", { name: "推荐大小", exact: true }).click();
        assert.equal(await scale.inputValue(), "100", "builtin artwork keeps its legacy recommended size");
        await waitForScale(100);
        await input.setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: png });
        await page.getByAltText("已上传的二维码中心图片").waitFor();
        await page.getByRole("button", { name: "推荐大小", exact: true }).click();
        await waitForScale(130);
        assert.equal(await scale.inputValue(), "130");
        await fs.mkdir("output", { recursive: true });
        await page.screenshot({ path: `output/card-qr-center-size-${width}-${mode}.png`, fullPage: true });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "mobile controls must not overflow");
        assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
});
