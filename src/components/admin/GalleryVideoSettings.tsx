"use client";
import type { GalleryVideoProps } from "@/lib/galleryVideo";
type Value = GalleryVideoProps & { galleryControls?: "hero" | "none" };
export default function GalleryVideoSettings({ value, onChange }: { value: Value; onChange: (patch: Partial<Value>) => void }) {
  const media = value.galleryMedia || "images";
  return <fieldset data-gallery-video-settings className="mt-3 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
    <legend className="px-1 font-semibold">相册与视频</legend>
    <label className="flex flex-wrap items-center gap-3">媒体类型
      <select aria-label="媒体类型" className="rounded border bg-white p-2" value={media}
        onChange={event => onChange({ galleryMedia: event.target.value as GalleryVideoProps["galleryMedia"] })}>
        <option value="images">图片相册／轮播</option><option value="background-video">静音视频背景</option><option value="video">视频播放（保留声音与播放控件）</option>
      </select>
    </label>
    {media !== "images" ? <>
      <label className="block">视频地址（HTTPS MP4／WebM）<input aria-label="视频地址" type="url" className="mt-1 w-full rounded border bg-white p-2" value={value.galleryVideoUrl || ""} onChange={event => onChange({ galleryVideoUrl: event.target.value })} /></label>
      <label className="block">手机版视频地址（留空沿用电脑版）<input aria-label="手机版视频地址" type="url" className="mt-1 w-full rounded border bg-white p-2" value={value.galleryVideoMobileUrl || ""} onChange={event => onChange({ galleryVideoMobileUrl: event.target.value })} /></label>
      <label className="block">视频封面地址（留空使用相册第一张）<input aria-label="视频封面地址" className="mt-1 w-full rounded border bg-white p-2" value={value.galleryVideoPosterUrl || ""} onChange={event => onChange({ galleryVideoPosterUrl: event.target.value })} /></label>
      <label className="flex items-center gap-3">背景画面位置<select aria-label="背景画面位置" className="rounded border bg-white p-2" value={value.galleryVideoPosition || "50% 50%"} onChange={event => onChange({ galleryVideoPosition: event.target.value })}>
        <option value="50% 35%">偏上</option><option value="50% 50%">居中</option><option value="50% 55%">中下</option><option value="50% 65%">偏下</option>
      </select></label>
      <p className="text-xs leading-5 text-slate-600">背景视频静音循环，不显示相册切换、页码或照片按钮。先显示封面，播放受限、减少动态或省流模式时保留封面；编辑器内只显示静态预览。竖拍视频铺满横屏时会裁切上下画面。</p>
    </> : <label className="flex items-center gap-3">相册控制<select aria-label="相册控制" className="rounded border bg-white p-2" value={value.galleryControls || "default"} onChange={event => onChange({ galleryControls: event.target.value === "default" ? undefined : event.target.value as "hero" | "none" })}>
      <option value="default">默认</option><option value="hero">官网轮播控制</option><option value="none">隐藏控制与页码</option>
    </select></label>}
  </fieldset>;
}
