"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Block } from "@/data/homeBlocks";
import BlockRenderer from "@/components/blocks/BlockRenderer";
import { serviceDirectoryBlocks } from "@/lib/serviceDirectory";
import { serviceButton, type ServicePanelProps } from "./serviceCenterClient";

export default function ServiceDirectory({ active }: ServicePanelProps) {
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320);
  useEffect(() => {
    const element = host.current; if (!element) return;
    const observer = new ResizeObserver(() => { if (element.clientWidth) setWidth(element.clientWidth); });
    observer.observe(element); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!active || blocks.length) return;
    const controller = new AbortController();
    void fetch("/api/platform-published", { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error();
      const data = await response.json() as { blocks?: Block[] };
      const source = data.blocks ?? [];
      if (controller.signal.aborted) return;
      setBlocks(source);
      if (!serviceDirectoryBlocks(source, 320).some(block => block.type === "merchant-list")) setError("暂无可展示的商户目录。");
    }).catch(() => { if (!controller.signal.aborted) setError("商户目录暂时无法读取。"); });
    return () => controller.abort();
  }, [active, attempt, blocks.length]);
  const displayed = useMemo(() => serviceDirectoryBlocks(blocks, width), [blocks,width]);
  return <div ref={host} data-service-directory>
    {error ? <div role="alert"><p>{error}</p><button className={serviceButton} onClick={() => { setError(""); setAttempt(value => value + 1); }}>重新读取</button></div> : !blocks.length ? <p role="status">正在读取商户目录…</p> : null}
    <BlockRenderer blocks={displayed} forceMobileViewport={false} />
  </div>;
}
