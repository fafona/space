function normalizeSupportText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function stripSupportMessagePrefix(value: string, prefixes: string[]) {
  const normalized = normalizeSupportText(value);
  if (!normalized) return "";
  for (const prefix of prefixes) {
    if (normalized.startsWith(prefix)) {
      return normalized.slice(prefix.length).trim();
    }
  }
  return normalized;
}

function isSupportImageUrl(value: string) {
  return /\.(?:png|jpe?g|gif|webp|bmp|svg)(?:$|[?#])/i.test(value) || /^data:image\//i.test(value);
}

function isSupportImageLabel(value: string) {
  return /^(?:图片|照片|拍照)\s*[:：]/.test(value);
}

function isSupportUrlLike(value: string) {
  return /^(?:https?:\/\/|www\.|\/|data:image\/)/i.test(value);
}

export function splitSupportLinkToken(value: string) {
  let link = value;
  let trailing = "";
  while (link.length > 0 && /[),.;!?，。！？；：》】」)]$/.test(link)) {
    trailing = `${link.slice(-1)}${trailing}`;
    link = link.slice(0, -1);
  }
  return {
    link,
    trailing,
  };
}

export function normalizeSupportLinkHref(value: string) {
  const normalized = normalizeSupportText(value);
  if (!normalized) return "";
  const withProtocol = normalized.startsWith("www.") ? `https://${normalized}` : normalized;
  const baseOrigin = typeof window !== "undefined" ? window.location.origin : "https://faolla.com";
  try {
    return new URL(withProtocol, baseOrigin).toString();
  } catch {
    return "";
  }
}

function extractSupportImageMessageUrl(value: string) {
  const candidate = stripSupportMessagePrefix(value, ["图片：", "图片:", "照片：", "照片:", "拍照：", "拍照:"]);
  if (!candidate || !isSupportUrlLike(candidate)) return "";
  const href = normalizeSupportLinkHref(candidate);
  return isSupportImageUrl(href) ? href : "";
}

function extractSupportLinkMessageUrl(value: string) {
  const candidate = stripSupportMessagePrefix(value, ["联系卡：", "联系卡:", "链接：", "链接:", "联系卡", "链接"]);
  if (!candidate || !isSupportUrlLike(candidate)) return "";
  return normalizeSupportLinkHref(candidate);
}

export function isSupportShortMerchantCardLink(value: string) {
  const href = normalizeSupportLinkHref(value);
  if (!href) return false;
  try {
    const parsed = new URL(href);
    return /^\/card\/[a-z0-9][a-z0-9_-]{5,63}\/?$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

export type SupportMessageAttachmentPreview = {
  imageUrl: string;
  linkUrl: string;
};

export function parseSupportMessageAttachmentPreview(value: string): SupportMessageAttachmentPreview | null {
  const lines = String(value ?? "")
    .split(/\r?\n/)
    .map((line) => normalizeSupportText(line))
    .filter(Boolean);
  if (lines.length === 0) return null;

  const firstImageUrl = extractSupportImageMessageUrl(lines[0]);
  if (firstImageUrl) {
    const secondLineUrl = lines.length >= 2 ? extractSupportLinkMessageUrl(lines[1]) : "";
    return {
      imageUrl: firstImageUrl,
      linkUrl: secondLineUrl && secondLineUrl !== firstImageUrl ? secondLineUrl : "",
    };
  }

  if (lines.length >= 2 && isSupportImageLabel(lines[0])) {
    const secondImageUrl = extractSupportImageMessageUrl(lines[1]);
    if (secondImageUrl) {
      return {
        imageUrl: secondImageUrl,
        linkUrl: "",
      };
    }
  }

  return null;
}

export function formatSupportConversationPreview(value: string | null | undefined) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const attachmentPreview = parseSupportMessageAttachmentPreview(text);
  if (attachmentPreview?.imageUrl && attachmentPreview.linkUrl) return "名片";
  if (attachmentPreview?.imageUrl) return "图片";
  const lines = text
    .split(/\r?\n/)
    .map((line) => normalizeSupportText(line))
    .filter(Boolean);
  return lines[0] || text;
}
