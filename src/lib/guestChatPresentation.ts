// Short, ordinary UI labels, not machine-translated names. The number is
// display-only and stays unchanged. Server names remain backward-compatible.
const labels: Readonly<Record<string, string>> = {
  "zh-CN": "访客", "zh-TW": "訪客", ja: "ゲスト", ko: "게스트", en: "Guest",
  es: "Invitado", de: "Gast", fr: "Invité", tr: "Misafir", it: "Ospite",
  pl: "Gość", uk: "Гість", nl: "Gast", ro: "Oaspete", pt: "Convidado",
  ru: "Гость", el: "Επισκέπτης", cs: "Host", sv: "Gäst", hu: "Vendég",
  be: "Госць", bg: "Гост", sr: "Гост", da: "Gæst", fi: "Vieras",
  sk: "Hosť", no: "Gjest", hr: "Gost", bs: "Gost", sq: "Vizitor",
  lt: "Svečias", sl: "Gost", lv: "Viesis", et: "Külaline", mk: "Гост",
  ca: "Convidat", eu: "Gonbidatua", gl: "Convidado", cy: "Gwestai",
  is: "Gestur", ga: "Aoi", mt: "Mistieden", lb: "Gaascht",
};
export function guestChatLabel(locale: string) {
  const normalized = locale.replace(/_/g, "-");
  if (/^zh(?:-|$)/i.test(normalized)) return /(?:TW|HK|MO|Hant)/i.test(normalized) ? labels["zh-TW"] : labels["zh-CN"];
  return labels[normalized.split("-")[0].toLowerCase()] ?? labels.en;
}
export function localizedGuestChatName(number: string, locale: string) {
  const label = guestChatLabel(locale);
  return /^\d{8}$/.test(number) ? `${label}${/^(?:zh|ja|ko)(?:-|$)/i.test(locale.replace(/_/g,"-")) ? "" : " "}${number}` : label;
}
