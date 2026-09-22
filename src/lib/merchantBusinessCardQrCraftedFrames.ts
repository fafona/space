import { BUSINESS_CARD_QR_STUDIO_FRAMES } from "./merchantBusinessCardQrStudioAssets";

// Versioned artwork: never replace the renderer of an ID already saved on a card.
type Frame = { id: string; label: string; group: string; color: string; qr: { x: number; y: number; side: number }; caption: { x: number; y: number }; source?: string };
const original = BUSINESS_CARD_QR_STUDIO_FRAMES.map(f => ({ ...f, id: f.id.replace("studio-", "crafted-"), source: f.id, group: "经典精选" }));
const designs = [
  ["takeaway", "外带咖啡", "餐饮烘焙", "#a27248"], ["tea", "珍珠奶茶", "餐饮烘焙", "#b38868"],
  ["bread", "奶油吐司", "餐饮烘焙", "#ba803f"], ["chef", "主厨推荐", "餐饮烘焙", "#698293"],
  ["plate", "瓷盘餐桌", "餐饮烘焙", "#527f82"], ["icecream", "甜筒冰淇淋", "餐饮烘焙", "#d68094"],
  ["cake", "生日蛋糕", "餐饮烘焙", "#c36d88"], ["store", "街角小店", "零售生活", "#638f79"],
  ["house", "温暖小屋", "零售生活", "#ba775d"], ["phone", "智能手机", "数码影像", "#3f779a"],
  ["polaroid", "即时相片", "数码影像", "#789b98"], ["camera", "复古相机", "数码影像", "#786756"],
  ["shield", "守护徽章", "健康服务", "#547eaa"], ["flower", "花开时刻", "零售生活", "#c3809f"],
  ["paw", "萌宠足迹", "健康服务", "#b88c66"], ["tooth", "微笑牙齿", "健康服务", "#6caaa9"],
  ["medical", "健康药箱", "健康服务", "#59978d"], ["lotion", "护肤乳液", "美业护理", "#94a681"],
  ["perfume", "香氛瓶", "美业护理", "#b88f58"], ["mirror", "梳妆镜", "美业护理", "#b47788"],
  ["book", "知识书页", "教育办公", "#6788a4"], ["graduation", "毕业纪念", "教育办公", "#566b96"],
  ["briefcase", "商务公文包", "教育办公", "#99724e"], ["suitcase", "旅行行李箱", "出行物流", "#539594"],
  ["truck", "配送货车", "出行物流", "#cf9350"], ["rocket", "探索火箭", "科技文娱", "#608cb4"],
  ["gamepad", "游戏手柄", "科技文娱", "#8a80b7"], ["record", "黑胶唱片", "科技文娱", "#9b789f"],
  ["palette", "画室调色盘", "科技文娱", "#ba9470"], ["leaf", "自然绿叶", "零售生活", "#659279"],
];
const placement: Record<string, { x: number; y: number; side: number; captionY: number; captionX?: number }> = {
  bread: { x: 133, y: 169, side: 234, captionY: 442 },
  chef: { x: 136, y: 196, side: 228, captionY: 473 },
  store: { x: 136, y: 221, side: 228, captionY: 478 },
  house: { x: 137, y: 216, side: 226, captionY: 470 },
  flower: { x: 145, y: 185, side: 210, captionY: 421 },
  lotion: { x: 137, y: 210, side: 226, captionY: 469 },
  perfume: { x: 136, y: 220, side: 228, captionY: 478 },
  book: { x: 135, y: 165, side: 230, captionY: 430 },
  graduation: { x: 138, y: 216, side: 224, captionY: 473 },
  gamepad: { x: 147, y: 180, side: 206, captionY: 414 },
  leaf: { x: 151, y: 198, side: 198, captionY: 431 },
  mirror: { x: 145, y: 170, side: 210, captionY: 414 },
  icecream: { x: 143, y: 146, side: 214, captionY: 389 },
  polaroid: { x: 112, y: 131, side: 276, captionY: 472 },
  camera: { x: 154, y: 204, side: 192, captionY: 495 },
  record: { x: 144, y: 194, side: 212, captionY: 435 },
  phone: { x: 132, y: 182, side: 236, captionY: 451 },
  cake: { x: 132, y: 211, side: 236, captionY: 478 },
  medical: { x: 137, y: 230, side: 226, captionY: 487 },
  briefcase: { x: 132, y: 211, side: 236, captionY: 478 },
  suitcase: { x: 139, y: 192, side: 222, captionY: 445 },
  truck: { x: 77, y: 186, side: 234, captionY: 451, captionX: 194 },
  rocket: { x: 148, y: 212, side: 204, captionY: 447 },
  palette: { x: 143, y: 194, side: 214, captionY: 439 },
  tooth: { x: 132, y: 172, side: 236, captionY: 439 },
  paw: { x: 145, y: 248, side: 210, captionY: 491 },
  takeaway: { x: 138, y: 204, side: 224, captionY: 459 },
};
export const BUSINESS_CARD_QR_CRAFTED_FRAMES: readonly Frame[] = [
  ...original,
  ...designs.map(([id, label, group, color]) => {
    const pos = placement[id] ?? { x: 145, y: 205, side: 210, captionY: 448 };
    return { id: `crafted-${id}`, label, group, color, qr: { x: pos.x * 2, y: pos.y * 2, side: pos.side * 2 }, caption: { x: (pos.captionX ?? 250) * 2, y: pos.captionY * 2 } };
  }),
];
export function businessCardQrCraftedFrameGeometry(id: string, padding: number) {
  const f = BUSINESS_CARD_QR_CRAFTED_FRAMES.find(f => f.id === id);
  if (!f) return null;
  const inset = (padding - 16) * 2;
  return { x: f.qr.x + inset, y: f.qr.y + inset, side: f.qr.side - inset * 2, width: 1000, height: 1140, captionX: f.caption.x, captionY: f.caption.y, captionWidth: 360 };
}
export function businessCardQrCraftedSelection(id: string) {
  const f = BUSINESS_CARD_QR_CRAFTED_FRAMES.find(f => f.id === id);
  // Picking new artwork applies its authored frame palette, never QR/icon colors.
  return f ? { frame: id, frameColor: f.color, frameBackgroundColor: "#ffffff", frameWidth: 2, framePadding: 16 } : { frame: id };
}
function mix(a: string, b: string, t: number) {
  return "#" + [1, 3, 5].map(i => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - t) + parseInt(b.slice(i, i + 2), 16) * t).toString(16).padStart(2, "0")).join("");
}
function hsl(hex: string) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const hi = Math.max(r, g, b), lo = Math.min(r, g, b), d = hi - lo, l = (hi + lo) / 2;
  const h = !d ? 0 : hi === r ? ((g - b) / d + (g < b ? 6 : 0)) / 6 : hi === g ? ((b - r) / d + 2) / 6 : ((r - g) / d + 4) / 6;
  return [h, d ? d / (1 - Math.abs(2 * l - 1)) : 0, l];
}
function rgb(h: number, s: number, l: number) {
  const a = s * Math.min(l, 1 - l);
  return "#" + [0, 8, 4].map(n => { const k = (n + h * 12) % 12; return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, "0"); }).join("");
}
// Retain original lightness and relative accent hues instead of flattening a
// full illustration into four brightness buckets. Default palette is exact.
function recolor(body: string, originalColor: string, color: string, background: string) {
  const [oh, os, ol] = hsl(originalColor), [nh, ns, nl] = hsl(color);
  return body.replace(/#[0-9a-f]{3,6}\b/gi, raw => {
    const v = (raw.length === 4 ? "#" + raw.slice(1).split("").map(c => c + c).join("") : raw).toLowerCase();
    if (v === "#ffffff") return background;
    if (color.toLowerCase() === originalColor.toLowerCase()) return v;
    const [h, s, l] = hsl(v);
    if (s < .04) return v;
    return rgb((h + nh - oh + 1) % 1, Math.min(1, s * (os ? ns / os : 1)), Math.max(.06, Math.min(.99, l + (nl - ol) * (1 - l))));
  });
}
export function renderBusinessCardQrCraftedFrame(id: string, color: string, background: string, width: number): string | null {
  const frame = BUSINESS_CARD_QR_CRAFTED_FRAMES.find(f => f.id === id);
  if (!frame) return null;
  if (frame.source) {
    const source = BUSINESS_CARD_QR_STUDIO_FRAMES.find(f => f.id === frame.source)!;
    const body = recolor(source.body, source.color, color, background).replace(/stroke-width="([\d.]+)"/g, (_, n) => `stroke-width="${Number(n) * width / 2}"`);
    return `<g transform="translate(0 50) scale(2)">${body}</g>`;
  }
  const dark = mix(color, "#132438", .25), pale = mix(color, background, .86), light = mix(color, background, .57);
  const sw = width * 1.7, gid = id + "-paint", paper = id + "-paper", depth = id + "-depth";
  const fill = `url(#${gid})`, cream = `url(#${paper})`;
  const p = (d: string, f = fill, s = color, w = sw) => `<path d="${d}" fill="${f}" stroke="${s}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"/>`;
  const r = (x: number, y: number, w: number, h: number, rx: number, f = cream, s = color, stroke = sw) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${f}" stroke="${s}" stroke-width="${stroke}"/>`;
  const c = (x: number, y: number, radius: number, f = cream, s = color, stroke = sw) => `<circle cx="${x}" cy="${y}" r="${radius}" fill="${f}" stroke="${s}" stroke-width="${stroke}"/>`;
  const e = (x: number, y: number, rx: number, ry: number, f = cream, s = color, stroke = sw) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${f}" stroke="${s}" stroke-width="${stroke}"/>`;
  const panel = () => {
    // Printed labels suit packaging/screens, but look pasted-on inside natural
    // silhouettes. Those use the white centre of their own surface instead.
    if (["bread", "chef", "plate", "icecream", "house", "shield", "paw", "tooth", "mirror", "rocket", "palette", "leaf", "polaroid", "phone", "cake", "medical", "briefcase", "suitcase", "truck"].includes(id.slice(8))) return "";
    const x = frame.qr.x / 2 - 10, y = frame.qr.y / 2 - 10, w = frame.qr.side / 2 + 20;
    const h = frame.caption.y / 2 - y + 13;
    return r(x, y + 3, w, h, 18, mix(color, background, .81), "none", 0)
      + r(x, y, w, h, 18, background, mix(color, background, .88), .8);
  };
  let art = "";
  switch (id.slice(8)) {
    case "takeaway": art = p("M98 149H402L375 486Q250 509 125 486Z",cream)
      + p("M106 230Q250 243 394 230L381 411Q250 430 119 411Z",fill)
      + p("M110 242Q250 255 390 242m-267 157q127 18 254 0", "none",light,3)
      + p("M119 184 125 217m253-33-6 33", "none",background,6)
      + p("M128 480Q250 502 372 480", "none",light,5)
      + r(81,135,338,28,11,fill,dark,2)
      + p("M104 135 127 91H373L396 135Z",fill,dark,2)
      + p("M135 101H365m-260 45H395", "none",light,4)
      + r(297,98,42,7,3,dark,"none")
      + p("M190 71c-23-19 19-26 0-45m60 45c-23-19 19-26 0-45", "none",light,5)
      + panel(); break;
    case "tea": art = p("M287 140 313 36h21l-25 108Z", fill) + p("M323 42 304 128", "none", pale, 4)
      + p("M100 157H400L374 490Q250 508 126 490Z", cream)
      + p("M106 213Q251 192 395 213L374 490Q250 508 126 490Z", light, "none")
      + p("M106 214Q250 193 395 214", "none", pale, 6)
      + p("M120 420H380L374 490Q250 508 126 490Z", fill, "none")
      + [145,180,215,250,285,320,355].map((x,i)=>c(x,477+i%2*7,9,dark,"none")+c(x-2,474+i%2*7,2,light,"none")).join("")
      + r(83,135,334,30,14,fill) + p("M105 144H395", "none",pale,5)
      + p("M120 184 128 325", "none",background,7) + panel(); break;
    case "bread": art = p("M94 479V210C22 165 38 73 119 67Q150 27 200 55Q251 25 303 55Q361 23 389 70C464 87 473 167 406 210V479Q250 510 94 479Z",fill)
      + p("M115 466V197C54 155 73 91 135 92Q164 57 205 79Q250 53 299 80Q344 55 375 95C430 105 445 157 385 198V466Q250 489 115 466Z",cream,light,3)
      + p("M131 131q19-23 49-15m42-15q27-12 55 0m49 14q28-8 45 16", "none",background,8)
      + [[111,230],[394,282],[110,372],[392,403],[158,475],[339,476]].map(([x,y])=>e(x,y,3,5,light,"none")).join("") + panel(); break;
    case "chef": art = p("M103 201C21 193 22 91 101 81Q126 25 188 62Q250 5 308 62Q374 24 399 81C479 90 481 193 397 201L386 492H114Z",cream)
      + p("M55 132q-3 44 50 48M144 76q-26 11-30 32M220 69q27-22 56 0M390 181q43-3 54-36", "none",background,7)
      + p("M117 204 127 323m256-119-10 119M158 160l5 25m175-25-5 25", "none",light,4)
      + p("M114 441Q250 451 386 441L384 488Q250 506 116 488Z",fill)
      + p("M127 449Q250 458 373 449L371 479Q250 492 129 479Z",background,light,2)
      + p("M144 482Q250 491 356 482", "none",pale,2) + panel(); break;
    case "plate": art = e(250,300,197,208,fill) + e(250,300,186,197,cream,light,2)
      + e(250,300,167,178,"none",light,2) + e(250,300,157,167,background,pale,4)
      + p("M112 169q39-55 108-64m120 364q45-26 67-73", "none",background,5)
      + p("M18 150v79q0 28 20 28t20-28v-79m-27 0v80m14-80v80", "none",color,5)
      + p("M38 258v70", "none",color,7) + r(29,317,18,147,9,fill)
      + p("M466 147q-29 29-29 92q0 25 29 27Z",cream,color,3)
      + p("M466 261v64", "none",color,6) + r(457,316,18,148,9,fill)
      + p("M35 335v105m428-105v105", "none",light,3); break;
    case "icecream": art = p("M132 379 250 546 368 379Z", "#e4bb82", "#bb8d58",3)
      + `<defs><clipPath id="${id}-waffle"><path d="M140 383 250 537 360 383Z"/></clipPath></defs><g clip-path="url(#${id}-waffle)">`
      + [-90,-45,0,45,90,135].map(n=>p(`M${124+n} 379l167 167M${376-n} 379l-167 167`,"none","#f9dbb1",3)).join("") + "</g>"
      + p("M89 384C26 291 41 153 113 127C139 42 216 29 250 68C323 20 384 71 390 134C471 157 463 311 411 384Q393 424 359 398Q326 431 292 409Q250 436 210 409Q175 430 144 399Q110 424 89 384Z",fill)
      + p("M103 378C47 289 58 165 125 140C151 61 212 53 250 88C316 43 366 91 378 148C449 170 445 300 399 378Q385 403 358 382Q326 414 292 393Q251 420 211 393Q179 414 146 383Q119 403 103 378Z",background,"none")
      + p("M107 196q9-31 35-37m41-55q23-14 47-6m85 19q25 2 34 23", "none",light,6)
      + p("M82 287q-4 38 16 68m312-109q14 43-4 85", "none",pale,5)
      + p("M174 428 250 536", "none","#f9dbb1",3); break;
    case "cake": art = e(250,514,207,12,light,"none") + r(71,191,358,305,20,cream)
      + p("M80 277H119m262 0h39M80 363h39m262 0h39M80 449h39m262 0h39", "none",light,7)
      + p("M72 166Q72 150 93 150H407Q428 150 428 171V229Q413 256 398 233V207Q382 183 366 208V239Q350 268 334 239V211Q318 183 301 211V226Q284 252 269 226V210Q250 183 231 210V239Q215 267 199 239V211Q182 184 166 211V225Q150 252 134 225V209Q118 184 102 209V232Q88 252 72 228Z",fill)
      + e(250,153,177,20,pale,color,2)
      + [174,250,326].map(x=>r(x-7,88,14,67,5,light,color,2)+p(`M${x-5} 107l10 7m-10 10 10 7m-10 10 10 7`,"none",background,3)+p(`M${x} 51q-19 27 0 30q19-3 0-30Z`,"#edba63","none")+p(`M${x} 64q-6 11 0 12`,"none","#fff0b9",3)).join("")
      + r(121,220,258,268,5,background,"none")
      + Array.from({length:17},(_,i)=>c(89+i*20,497,9,cream,light,1)).join("")
      + p("M64 514H436", "none",background,3); break;
    case "store": art = r(72,174,356,334,12,cream) + r(84,202,332,292,6,pale,light,3)
      + r(122,212,256,282,8,background,color,3)
      + p("M92 103H408L446 174H54Z",pale)
      + Array.from({length:6},(_,i)=>p(`M${92+i*52.66} 103h52.66L${54+(i+1)*65.33} 174v16q-32.66 33-65.33 0v-16Z`,i%2?pale:fill)).join("")
      + r(94,58,312,44,9,fill) + p("M116 73H384", "none",light,4)
      + c(109,80,2,pale,"none") + c(391,80,2,pale,"none")
      + p("M87 497H413", "none",color,10) + r(56,501,388,13,5,light,"none")
      + e(96,415,16,26,light,"none") + p("M81 437h31l-5 44H86Z",fill)
      + e(404,415,16,26,light,"none") + p("M389 437h31l-5 44H394Z",fill) + panel(); break;
    case "house": art = r(337,70,43,112,5,fill) + r(330,61,57,17,4,dark)
      + p("M78 224 250 90 422 224V505H78Z",cream)
      + p("M46 218 250 50 454 218 433 243 250 100 67 243Z",fill)
      + p("M73 221 250 70 427 221","none",light,5)
      + c(250,156,25,pale,color,3) + p("M225 156h50m-25-25v50", "none",color,3)
      + r(66,497,368,18,5,fill) + p("M86 260v220m328-220v220", "none",light,5)
      + p("M104 492v-35m-7 16 7-11 7 11m285 19v-35m-7 16 7-11 7 11", "none",color,3) + panel(); break;
    case "phone": art = r(85,36,330,498,43,fill,dark,3) + r(92,43,316,484,37,"none",light,2)
      + r(103,55,294,460,29,background,dark,2)
      + r(195,68,110,22,11,dark,"none") + c(287,79,4,light,"none")
      + p("M81 141v40m0 26v46m338-104v76", "none",dark,5)
      + p("M124 113h23m198-5v7m8-12v12m8-17v17", "none",color,3)
      + r(365,104,17,10,2,"none",color,2) + r(367,106,11,6,1,color,"none")
      + c(250,141,17,pale,"none") + p("M243 140l5 5 10-11", "none",color,3)
      + p("M120 178v-14h14m232 0h14v14M120 419v14h14m232 0h14v-14", "none",light,3)
      + r(205,483,90,5,3,light,"none") + p("M212 507h76", "none",dark,4); break;
    case "polaroid": art = `<g transform="rotate(3 250 290)">${r(85,83,338,433,7,pale,light,2)}</g>`
      + r(72,68,344,436,9,cream,color,2) + r(80,77,328,418,5,background,pale,1)
      + r(94,105,300,332,3,fill,"none") + r(100,111,288,320,1,background,"none")
      + p("M95 440H393", "none",pale,2)
      + p("M198 54 207 94 219 90 231 96 244 91 257 96 270 91 283 95 298 90 289 51 277 56 265 52 251 58 239 54 225 59 211 54Z",pale,light,1)
      + p("M210 63l6 19m8-20 6 21m8-21 6 21m8-21 6 21m8-21 6 21", "none",background,1)
      + c(118,474,3,light,"none") + c(382,474,3,light,"none"); break;
    case "camera": art = r(40,220,25,58,10,dark,"none") + r(435,220,25,58,10,dark,"none")
      + r(55,148,390,370,27,fill,dark,3) + r(62,156,376,355,21,"none",light,2)
      + r(66,158,368,84,17,cream,"none") + p("M67 232H433", "none",color,3)
      + r(87,122,67,27,6,fill,dark,2)
      + [95,105,115,125,135,145].map(x=>p(`M${x} 129v13`,"none",light,2)).join("")
      + p("M183 149 204 106H299L322 149Z",fill,dark,2)
      + r(219,116,63,24,5,dark,"none") + r(226,121,49,12,2,light,"none")
      + r(349,173,67,35,7,dark,"none") + r(355,178,55,25,4,background,light,1)
      + p("M365 181v19m8-19v19m8-19v19m8-19v19m8-19v19", "none",pale,2)
      + c(91,181,7,light,dark,2)
      + p("M76 285v142m9-142v142m330-142v142m9-142v142", "none",light,3)
      + c(250,300,168,dark,"none") + c(250,300,162,light,"none")
      + c(250,300,156,fill,dark,2) + c(250,300,151,background,light,2)
      + p("M137 202q27-33 65-44m96 284q29-10 51-34", "none",background,3)
      + r(147,476,206,29,9,background,light,1); break;
    case "shield": art = p("M250 44Q330 110 445 100V340Q445 465 250 536Q55 465 55 340V100Q170 110 250 44Z",fill) + p("M250 74Q332 132 423 123V334Q423 445 250 508Q77 445 77 334V123Q168 132 250 74Z",background,light,5) + p("M250 93 262 118 290 122 270 142 274 170 250 157 226 170 230 142 210 122 238 118Z",color,"none") + panel(); break;
    case "flower": art = Array.from({length:10},(_,i)=>`<g transform="rotate(${i*36} 250 285)">${p("M217 155C175 80 201 39 250 44C299 39 325 80 283 155L270 208H230Z",fill)}${p("M223 87q-10 22 4 49", "none",pale,5)}</g>`).join("")
      + c(250,285,165,light,"none") + c(250,285,153,background,color,3)
      + c(250,285,143,"none",pale,3); break;
    case "paw": art = [[94,162,49,64,-24],[196,111,43,62,-9],[304,111,43,62,9],[406,162,49,64,24]].map(([x,y,rx,ry,angle])=>`<g transform="rotate(${angle} ${x} ${y})">${e(x,y,rx,ry,fill)}${e(x,y+3,rx-10,ry-12,light,"none")}${p(`M${x-rx+16} ${y-7}q-1-22 16-29`,"none",pale,5)}</g>`).join("")
      + p("M250 177C127 170 53 303 51 413C44 526 163 543 250 520C337 543 456 526 449 413C447 303 373 170 250 177Z",fill)
      + p("M250 194C141 188 71 310 70 411C63 507 169 523 250 502C331 523 437 507 430 411C429 310 359 188 250 194Z",background,"none")
      + p("M102 336q8-56 37-86m-54 152q-1 59 41 77", "none",pale,5)
      + p("M183 522q37 1 67-7q30 8 67 7", "none",light,3); break;
    case "tooth": art = p("M250 79C90-24 23 116 87 277C91 350 78 535 149 523Q189 516 208 465Q250 432 292 465Q311 516 351 523C422 535 409 350 413 277C477 116 410-24 250 79Z",fill)
      + p("M249 98C111 9 44 121 105 274C110 347 95 511 148 503Q176 498 192 459Q250 414 308 459Q324 498 352 503C405 511 390 347 395 274C455 124 391 8 249 98Z",background,"none")
      + p("M134 113q39-32 84-10m-95 50q-11 42 5 80", "none",pale,7)
      + p("M251 98q35 20 67 6m-201 206q-3 112 21 150m245-138q5 87-19 127", "none",light,4)
      + p("M418 54l5 16 16 5-16 5-5 16-5-16-16-5 16-5Z",light,"none")
      + p("M445 121v17m-8-8h16", "none",color,3); break;
    case "medical": art = r(183,70,134,77,18,fill,dark,2) + r(203,87,94,43,8,background,"none")
      + r(63,131,374,381,27,fill) + r(73,143,354,355,21,background,light,2)
      + p("M74 195H426", "none",light,3) + r(91,174,31,43,7,fill) + r(378,174,31,43,7,fill)
      + p("M100 184h13m274 0h13", "none",pale,4)
      + c(250,177,37,background,light,2)
      + p("M242 153h16v16h16v16h-16v16h-16v-16h-16v-16h16Z",fill,"none")
      + p("M83 236v215m334-215v215", "none",pale,5)
      + p("M79 474v12q0 11 14 11h22m306-23v12q0 11-14 11h-22", "none",light,7)
      + c(91,227,3,light,"none") + c(409,227,3,light,"none"); break;
    case "lotion": art = r(217,65,66,70,8,fill) + p("M216 64V39H329Q344 39 344 54V68H321V60H256V66Z",fill)
      + r(198,111,104,32,6,fill) + p("M211 122H289", "none",light,4)
      + p("M150 148Q181 134 250 134T350 148Q396 160 396 214V476Q396 513 358 517H142Q104 513 104 476V214Q104 160 150 148Z",cream)
      + p("M124 224v235q0 37 26 39", "none",background,8)
      + p("M374 222v247q0 29-25 31", "none",light,6)
      + p("M144 186Q250 169 356 186", "none",light,3)
      + p("M159 508H341", "none",color,3) + panel(); break;
    case "perfume": art = r(207,96,86,65,6,fill) + r(173,40,154,67,9,dark)
      + r(181,47,138,50,5,fill) + p("M195 57H305m-110 9H305", "none",light,3)
      + p("M180 163H320L411 233V476Q411 509 379 511H121Q89 509 89 476V233Z",cream)
      + p("M180 164 114 240v230q0 16 17 17H369q17 0 17-17V240L320 164", "none",light,6)
      + p("M113 259v160m274-154v80", "none",background,7)
      + r(178,151,144,25,7,fill) + p("M192 160H308", "none",light,3)
      + p("M250 176q-81-17-78 15q3 20 78-15q81-17 78 15q-3 20-78-15m0 0-27 23m27-23 28 23", "none",color,3)
      + panel(); break;
    case "mirror": art = r(236,433,28,76,12,fill) + e(250,512,111,15,fill)
      + e(250,508,96,10,cream,light,2)
      + p("M69 269v35q0 181 181 181t181-181v-35", "none",color,8)
      + e(250,257,175,211,fill) + e(250,257,165,201,cream,light,2)
      + e(250,257,157,191,background,pale,3)
      + p("M117 192q26-88 104-113", "none",background,5)
      + p("M129 149l34-35m-39 62 55-55m163 263 20-20", "none",pale,5)
      + c(73,269,10,fill) + c(427,269,10,fill)
      + c(73,269,3,pale,"none") + c(427,269,3,pale,"none"); break;
    case "book": art = p("M250 108Q146 70 46 104V486Q151 459 250 503Q349 459 454 486V104Q354 70 250 108Z",fill)
      + p("M250 117Q149 80 62 115V469Q154 445 250 486Q346 445 438 469V115Q351 80 250 117Z",cream)
      + p("M72 445q78-12 155 13m46 0q77-25 155-13M72 455q78-12 155 13m46 0q77-25 155-13", "none",light,2)
      + p("M250 121v358", "none",light,3)
      + p("M82 135q69-18 133 4m69 0q64-22 133-4", "none",light,3)
      + p("M354 100h29v62l-14-10-15 10Z",fill,"none") + panel(); break;
    case "graduation": art = r(94,170,312,332,13,fill) + r(104,180,292,312,9,cream,light,2)
      + p("M156 100V165Q250 199 344 165V100",fill)
      + p("M250 32 437 109 250 185 63 109Z",fill)
      + p("M87 109 250 47 414 109", "none",light,4)
      + c(250,109,6,pale,"none") + p("M250 109 409 113v151", "none",light,4)
      + c(409,262,7,dark,"none") + p("M395 290 409 263 424 290Z",fill)
      + p("M116 197h17m234 0h17m-268 282h17m234 0h17", "none",light,3) + panel(); break;
    case "briefcase": art = r(180,78,140,89,19,fill,dark,3) + r(201,98,98,52,9,background,"none")
      + p("M190 103q0-16 17-16h85q18 0 18 16", "none",light,3)
      + r(55,154,390,357,24,fill,dark,3) + r(64,163,372,339,19,"none",light,2)
      + r(79,183,342,307,12,background,light,2)
      + p("M69 184v96q181 46 362 0v-96",cream,color,2)
      + r(122,216,256,273,3,background,"none")
      + [91,383].map(x=>r(x,206,26,180,5,fill)+r(x-3,283,32,44,5,"#e5cf9f",dark,2)+r(x+4,291,18,26,2,fill,dark,1)+p(`M${x+13} 286v20`,"none","#fff1d4",3)).join("")
      + p("M85 480h26m278 0h26", "none",light,3); break;
    case "suitcase": art = r(195,40,110,114,15,dark,"none") + r(209,54,82,87,6,background,"none")
      + r(185,36,130,25,10,fill) + p("M200 44h100", "none",light,3)
      + r(88,127,324,368,33,fill,dark,3) + r(98,138,304,346,26,"none",light,2)
      + [115,376].map(x=>r(x,166,9,287,5,light,"none")+r(x+2,169,2,273,1,pale,"none")).join("")
      + r(129,177,242,296,15,background,light,2)
      + r(114,481,32,43,11,dark,"none") + r(354,481,32,43,11,dark,"none")
      + p("M124 492v19m240-19v19", "none",light,4)
      + r(176,146,59,16,7,dark,"none") + p("M198 152h14", "none",light,3)
      + p("M328 119q19 7 12 30", "none",dark,3)
      + `<g transform="rotate(12 353 165)">${r(332,143,43,45,5,"#f1dab4",color,2)}${r(340,154,27,18,2,background,"none")}${c(353,148,2,color,"none")}</g>`; break;
    case "truck": art = r(38,139,296,342,16,fill) + r(48,151,276,319,9,background,light,2)
      + p("M60 167h251m-251 296h251", "none",pale,3)
      + p("M334 251H409Q421 251 430 270L479 362V478H334Z",fill,dark,2)
      + p("M347 268H405L446 346H347Z",light,color,2)
      + p("M354 275h43l31 61h-74Z", "#e9f2f5","none")
      + p("M365 279l-7 36m19-36-18 45", "none",background,4)
      + p("M341 358h113v99H341Z", "none",light,2)
      + r(350,370,25,7,3,dark,"none") + r(466,368,15,26,3,"#fff0b9",color,2)
      + r(27,468,458,20,7,fill,dark,2)
      + [102,413].map(x=>c(x,486,34,dark,"none")+c(x,486,22,light,"none")+c(x,486,14,cream,dark,2)+c(x,486,4,color,"none")).join("")
      + r(318,276,11,33,4,dark,"none") + p("M331 271v166", "none",light,3); break;
    case "rocket": art = p("M137 319Q75 348 65 484L147 450M363 319Q425 348 435 484L353 450",fill,dark,2)
      + p("M89 449q10-61 36-86m286 86q-10-61-36-86", "none",light,5)
      + p("M200 473Q193 515 221 535L236 522 250 556 274 531 290 537Q312 504 300 473Z","#e5a468","none")
      + p("M224 477Q216 510 250 534Q281 511 276 477Z","#ffe8ad","none")
      + p("M250 30C129 98 94 300 140 470H360C406 300 371 98 250 30Z",cream,color,3)
      + p("M250 30Q186 67 155 153Q250 169 345 153Q314 67 250 30Z",fill)
      + p("M250 47q-44 30-66 76", "none",light,5)
      + c(250,171,32,fill,dark,2) + c(250,171,24,"#e3eff4",background,3)
      + p("M237 173l15-17m-9 31 20-24", "none",background,4)
      + p("M126 255q-4 87 15 143m233-143q4 87-15 143", "none",light,3)
      + r(142,459,216,20,7,fill) + p("M162 466h176", "none",pale,3); break;
    case "gamepad": art = p("M98 160v-14q0-21 23-21h61v37m136 0v-37h61q23 0 23 21v14",dark)
      + p("M250 151V86q0-19 21-19", "none",dark,5)
      + p("M124 153Q68 151 41 238Q17 326 23 427Q24 499 79 496Q111 492 152 437H348Q389 492 421 496Q476 499 477 427Q483 326 459 238Q432 151 376 153Z",fill)
      + p("M50 342q-10 83 9 113m391-113q10 83-9 113", "none",light,7)
      + r(132,164,236,274,25,cream,"none")
      + c(80,253,37,dark,"none") + p("M80 231v44m-22-22h44", "none",pale,13)
      + [[418,226],[445,253],[418,280],[391,253]].map(([x,y],i)=>c(x,y,11,i%2?pale:light,dark,2)).join("")
      + c(90,384,27,dark,"none") + c(90,384,18,light,"none")
      + c(410,384,27,dark,"none") + c(410,384,18,light,"none") + panel(); break;
    case "record": art = c(250,300,216,mix(color,"#17212d",.72),"none")
      + p("M81 172A212 212 0 0 1 187 97L204 150A158 158 0 0 0 123 207Z",mix(color,background,.22),"none")
      + p("M419 428A212 212 0 0 1 313 503L296 450A158 158 0 0 0 377 393Z",mix(color,background,.12),"none")
      + [208,200,192,184,176,168].map(n=>c(250,300,n,"none",mix(color,background,.18),.9)).join("")
      + c(250,300,171,fill,"none") + c(250,300,164,background,light,2)
      + p("M91 172q31-37 74-59m170 374q43-22 74-59", "none",light,2)
      + c(250,159,4,light,"none") + p("M220 449h60", "none",pale,3); break;
    case "palette": art = p("M247 67C46 52 8 270 51 414C93 552 327 548 433 425C482 367 439 331 420 299Q400 268 435 220C491 133 370 65 247 67Z",fill)
      + p("M245 79C61 64 22 273 64 409C104 533 322 531 423 417C463 370 426 338 407 305Q385 266 424 214C472 141 366 79 245 79Z",cream,light,2)
      + e(359,148,25,32,background,color,4)
      + p("M108 472q59 42 139 32M107 132q26-34 68-42", "none",light,3)
      + [[153,137,"#d895a5"],[95,218,"#dfb96e"],[86,326,"#7eaaa0"],[118,426,"#7f9fbe"],[367,449,"#a78aba"]].map(([x,y,f])=>`<g transform="translate(${x} ${y})">${p("M-18 9C-28-7-10-24 4-19C24-18 29 4 15 15Q-5 29-18 9Z",String(f),"none")}${p("M-11-5q6-9 15-6","none",mix(String(f),background,.52),4)}</g>`).join("")
      + `<g transform="rotate(10 444 331)">${r(438,243,12,238,6,fill,dark,2)}${r(436,217,16,42,3,"#d9dfe3",dark,1)}${p("M436 218Q424 188 444 151Q464 188 452 218Z",dark,"none")}${p("M444 173q-8 22-3 37","none",light,3)}</g>`; break;
    case "leaf": art = p("M102 478C15 343 66 141 251 92Q352 65 411 38C473 194 477 374 345 474Q230 548 102 478Z",fill)
      + p("M122 460C55 333 110 164 263 122Q345 102 397 70C442 215 442 360 328 451Q227 511 122 460Z",background,"none")
      + p("M102 478Q167 469 203 447M364 160Q395 97 412 40", "none",light,5)
      + p("M102 478 80 530", "none",color,7)
      + p("M111 422 84 350m43-132 52 27m180-130-65 18m119 96-30 52m-4 86-30 11M146 490l60-9", "none",light,4)
      + p("M116 285Q99 186 229 134", "none",pale,5) + panel(); break;
  }
  const defs = `<defs><linearGradient id="${gid}" x1="0" y1="0" x2=".8" y2="1"><stop stop-color="${light}"/><stop offset=".55" stop-color="${color}"/><stop offset="1" stop-color="${mix(color, dark, .4)}"/></linearGradient><linearGradient id="${paper}" x1="0" y1="0" x2="1" y2=".4"><stop stop-color="${pale}"/><stop offset=".28" stop-color="${background}"/><stop offset=".72" stop-color="${background}"/><stop offset="1" stop-color="${pale}"/></linearGradient><filter id="${depth}" x="-10%" y="-10%" width="120%" height="120%"><feDropShadow dx="0" dy="3" stdDeviation="2" flood-color="${dark}" flood-opacity=".12"/></filter></defs>`;
  return `<g transform="scale(2)">${defs}<g filter="url(#${depth})">${art}</g></g>`;
}
