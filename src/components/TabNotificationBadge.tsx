"use client";

import { useEffect } from "react";

type TabNotificationBadgeProps = {
  count: number;
  iconSrc?: string;
};

const DEFAULT_ICON_SRC = "/faolla-app-icon-192.png?v=20260409c";
const ICON_SELECTOR = 'link[rel="icon"], link[rel="shortcut icon"]';

function normalizeBadgeCount(count: number) {
  if (!Number.isFinite(count) || count <= 0) return 0;
  return Math.max(0, Math.min(999, Math.round(count)));
}

function formatBadgeLabel(count: number) {
  return count > 99 ? "99+" : String(count);
}

function drawRoundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const safeRadius = Math.max(0, Math.min(radius, width / 2, height / 2));
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.arcTo(x + width, y, x + width, y + height, safeRadius);
  context.arcTo(x + width, y + height, x, y + height, safeRadius);
  context.arcTo(x, y + height, x, y, safeRadius);
  context.arcTo(x, y, x + width, y, safeRadius);
  context.closePath();
}

async function renderBadgedFavicon(iconSrc: string, count: number) {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const next = new Image();
    next.crossOrigin = "anonymous";
    next.onload = () => resolve(next);
    next.onerror = () => reject(new Error("favicon_load_failed"));
    next.src = iconSrc;
  });

  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("favicon_context_unavailable");
  }

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  const label = formatBadgeLabel(count);
  const badgeHeight = 28;
  const badgeWidth = label.length >= 3 ? 38 : label.length === 2 ? 32 : 28;
  const badgeX = canvas.width - badgeWidth - 2;
  const badgeY = 2;

  drawRoundedRect(context, badgeX, badgeY, badgeWidth, badgeHeight, badgeHeight / 2);
  context.fillStyle = "#ff2d55";
  context.fill();

  context.lineWidth = 2;
  context.strokeStyle = "#ffffff";
  context.stroke();

  context.fillStyle = "#ffffff";
  context.font = label.length >= 3 ? "bold 14px system-ui, sans-serif" : "bold 16px system-ui, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(label, badgeX + badgeWidth / 2, badgeY + badgeHeight / 2 + 0.5);

  return canvas.toDataURL("image/png");
}

export function useTabNotificationBadge({
  count,
  iconSrc = DEFAULT_ICON_SRC,
}: TabNotificationBadgeProps) {
  useEffect(() => {
    if (typeof document === "undefined") return;

    const links = Array.from(document.querySelectorAll<HTMLLinkElement>(ICON_SELECTOR));
    if (links.length === 0) return;

    const originals = links.map((link) => ({
      link,
      href: link.getAttribute("href") ?? "",
    }));

    const badgeCount = normalizeBadgeCount(count);
    if (badgeCount <= 0) {
      originals.forEach(({ link, href }) => {
        link.setAttribute("href", href);
      });
      return;
    }

    let cancelled = false;
    renderBadgedFavicon(iconSrc, badgeCount)
      .then((dataUrl) => {
        if (cancelled) return;
        originals.forEach(({ link }) => {
          link.setAttribute("href", dataUrl);
        });
      })
      .catch(() => {
        // Keep the original favicon if the canvas badge cannot be rendered.
      });

    return () => {
      cancelled = true;
      originals.forEach(({ link, href }) => {
        link.setAttribute("href", href);
      });
    };
  }, [count, iconSrc]);
}

export default function TabNotificationBadge(props: TabNotificationBadgeProps) {
  useTabNotificationBadge(props);
  return null;
}
