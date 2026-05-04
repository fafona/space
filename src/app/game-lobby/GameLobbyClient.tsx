"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type CategoryId = "all" | "poker" | "mahjong" | "board" | "casual" | "mobile";

type Game = {
  id: string;
  name: string;
  category: Exclude<CategoryId, "all">;
  kind: string;
  players: string;
  online: number;
  rooms: number;
  pace: string;
  heat: number;
  accent: string;
  tone: string;
  tags: string[];
  icon: "cards" | "mahjong" | "chess" | "dice" | "rocket" | "star" | "phone" | "flag";
};

type Room = {
  id: string;
  gameId: string;
  name: string;
  level: string;
  online: number;
  tables: number;
  minCoins: number;
  speed: string;
  stake: string;
  access: "free" | "coins" | "friend" | "event";
};

type TableState = {
  gameName: string;
  roomName: string;
  tableNo: number;
  seats: number;
  ready: number;
};

const categoryTabs: Array<{ id: CategoryId; label: string; icon: IconName }> = [
  { id: "all", label: "全部", icon: "grid" },
  { id: "poker", label: "扑克", icon: "cards" },
  { id: "mahjong", label: "麻将", icon: "tile" },
  { id: "board", label: "棋类", icon: "chess" },
  { id: "casual", label: "休闲", icon: "dice" },
  { id: "mobile", label: "移动大厅", icon: "phone" },
];

const games: Game[] = [
  {
    id: "shuangkou",
    name: "千变双扣",
    category: "poker",
    kind: "四人扑克",
    players: "2v2",
    online: 24368,
    rooms: 48,
    pace: "中速",
    heat: 96,
    accent: "#d9480f",
    tone: "from-orange-50 to-red-50",
    tags: ["江浙", "癞子", "贡献"],
    icon: "cards",
  },
  {
    id: "doudizhu",
    name: "二人斗地主",
    category: "poker",
    kind: "扑克对战",
    players: "2人",
    online: 18904,
    rooms: 36,
    pace: "快速",
    heat: 91,
    accent: "#b42318",
    tone: "from-rose-50 to-amber-50",
    tags: ["单机", "联网", "快局"],
    icon: "cards",
  },
  {
    id: "paodekuai",
    name: "跑得快",
    category: "poker",
    kind: "扑克竞技",
    players: "3人",
    online: 12640,
    rooms: 26,
    pace: "极速",
    heat: 84,
    accent: "#f59e0b",
    tone: "from-amber-50 to-lime-50",
    tags: ["连胜", "低门槛", "短局"],
    icon: "rocket",
  },
  {
    id: "xueliu",
    name: "血流麻将",
    category: "mahjong",
    kind: "麻将",
    players: "4人",
    online: 21472,
    rooms: 42,
    pace: "中速",
    heat: 94,
    accent: "#0f9f6e",
    tone: "from-emerald-50 to-cyan-50",
    tags: ["定缺", "换三张", "多人"],
    icon: "mahjong",
  },
  {
    id: "huopinj",
    name: "火拼麻将",
    category: "mahjong",
    kind: "二人麻将",
    players: "2人",
    online: 17105,
    rooms: 30,
    pace: "快速",
    heat: 89,
    accent: "#059669",
    tone: "from-green-50 to-yellow-50",
    tags: ["二人", "实时", "好友"],
    icon: "mahjong",
  },
  {
    id: "wenzhou",
    name: "温州麻将",
    category: "mahjong",
    kind: "地方麻将",
    players: "4人",
    online: 9860,
    rooms: 20,
    pace: "标准",
    heat: 76,
    accent: "#047857",
    tone: "from-teal-50 to-stone-50",
    tags: ["地方规则", "番型", "亲友"],
    icon: "mahjong",
  },
  {
    id: "xiangqi",
    name: "中国象棋",
    category: "board",
    kind: "棋类",
    players: "1v1",
    online: 6438,
    rooms: 18,
    pace: "慢速",
    heat: 68,
    accent: "#7c2d12",
    tone: "from-red-50 to-stone-100",
    tags: ["排位", "残局", "观战"],
    icon: "chess",
  },
  {
    id: "weiqi",
    name: "围棋",
    category: "board",
    kind: "棋类",
    players: "1v1",
    online: 4812,
    rooms: 12,
    pace: "慢速",
    heat: 61,
    accent: "#3f3f46",
    tone: "from-zinc-50 to-emerald-50",
    tags: ["19路", "让子", "复盘"],
    icon: "chess",
  },
  {
    id: "bufuzai",
    name: "不服再试",
    category: "casual",
    kind: "国旗叠层三消",
    players: "单人",
    online: 15882,
    rooms: 28,
    pace: "短局",
    heat: 99,
    accent: "#0f766e",
    tone: "from-teal-50 to-sky-50",
    tags: ["国旗", "闯关", "道具"],
    icon: "flag",
  },
  {
    id: "flight",
    name: "飞行棋",
    category: "casual",
    kind: "休闲棋",
    players: "2-4人",
    online: 7284,
    rooms: 16,
    pace: "轻松",
    heat: 73,
    accent: "#2563eb",
    tone: "from-sky-50 to-yellow-50",
    tags: ["轻竞技", "好友", "道具"],
    icon: "dice",
  },
  {
    id: "mole",
    name: "打地鼠",
    category: "casual",
    kind: "休闲",
    players: "单人",
    online: 5906,
    rooms: 10,
    pace: "极速",
    heat: 70,
    accent: "#65a30d",
    tone: "from-lime-50 to-orange-50",
    tags: ["闯关", "积分", "排行"],
    icon: "star",
  },
  {
    id: "mobile-hall",
    name: "移动合集",
    category: "mobile",
    kind: "大厅",
    players: "多玩法",
    online: 30818,
    rooms: 64,
    pace: "随开",
    heat: 98,
    accent: "#0e7490",
    tone: "from-cyan-50 to-emerald-50",
    tags: ["移动端", "合集", "云同步"],
    icon: "phone",
  },
  {
    id: "tournament",
    name: "周赛专区",
    category: "mobile",
    kind: "活动",
    players: "多人",
    online: 11420,
    rooms: 22,
    pace: "定时",
    heat: 87,
    accent: "#9333ea",
    tone: "from-fuchsia-50 to-amber-50",
    tags: ["锦标赛", "榜单", "奖励"],
    icon: "star",
  },
];

const roomTemplates = [
  { id: "rookie", name: "新手场", level: "入门", minCoins: 0, speed: "12秒", stake: "低倍", access: "free" as const },
  { id: "standard", name: "标准场", level: "稳定", minCoins: 800, speed: "10秒", stake: "中倍", access: "coins" as const },
  { id: "advanced", name: "高手场", level: "进阶", minCoins: 5000, speed: "8秒", stake: "高倍", access: "coins" as const },
  { id: "friend", name: "好友房", level: "私密", minCoins: 0, speed: "不限", stake: "自定", access: "friend" as const },
  { id: "event", name: "锦标赛", level: "活动", minCoins: 1200, speed: "10秒", stake: "赛制", access: "event" as const },
];

const notices = [
  "五一休闲赛 20:00 开桌，前 128 名进入积分榜。",
  "双扣专区新增千变规则开关，好友房可单独保存。",
  "移动合集支持同账号跨端续局。",
];

const tasks = [
  { label: "每日首胜", reward: "茶豆 600", done: true },
  { label: "完成 3 局", reward: "抽奖券 1", done: false },
  { label: "邀请好友", reward: "头像框", done: false },
];

type IconName =
  | "bell"
  | "cards"
  | "chess"
  | "coin"
  | "dice"
  | "door"
  | "flag"
  | "grid"
  | "lightning"
  | "people"
  | "phone"
  | "play"
  | "plus"
  | "search"
  | "shield"
  | "star"
  | "tile"
  | "trophy";

function formatNumber(value: number) {
  if (value >= 10000) return `${(value / 10000).toFixed(value >= 100000 ? 0 : 1)}万`;
  return value.toLocaleString("zh-CN");
}

function buildRoomsForGame(game: Game, customRooms: Room[]) {
  const generatedRooms = roomTemplates.map((template, index) => ({
    ...template,
    id: `${game.id}-${template.id}`,
    gameId: game.id,
    online: Math.max(64, Math.round(game.online * (0.32 - index * 0.045))),
    tables: Math.max(6, Math.round(game.rooms * (0.34 - index * 0.035))),
  }));
  return [...customRooms.filter((room) => room.gameId === game.id), ...generatedRooms];
}

function accessLabel(access: Room["access"]) {
  if (access === "free") return "免门槛";
  if (access === "friend") return "房主邀请";
  if (access === "event") return "赛程";
  return "茶豆";
}

function Icon({ name, className = "h-4 w-4" }: { name: IconName; className?: string }) {
  const common = {
    className,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  if (name === "cards") {
    return (
      <svg {...common}>
        <rect x="5" y="4" width="10" height="14" rx="2" />
        <path d="M9 8h2M9 12h3" />
        <path d="M11 20h6a2 2 0 0 0 2-2V8" />
      </svg>
    );
  }
  if (name === "tile") {
    return (
      <svg {...common}>
        <rect x="6" y="3" width="12" height="18" rx="2" />
        <path d="M9 8h6M9 12h6M9 16h2M13 16h2" />
      </svg>
    );
  }
  if (name === "chess") {
    return (
      <svg {...common}>
        <circle cx="12" cy="7" r="3" />
        <path d="M9 10h6l1 8H8l1-8Z" />
        <path d="M7 21h10" />
      </svg>
    );
  }
  if (name === "dice") {
    return (
      <svg {...common}>
        <rect x="4" y="4" width="16" height="16" rx="3" />
        <path d="M8.5 8.5h.01M15.5 8.5h.01M12 12h.01M8.5 15.5h.01M15.5 15.5h.01" />
      </svg>
    );
  }
  if (name === "phone") {
    return (
      <svg {...common}>
        <rect x="8" y="3" width="8" height="18" rx="2" />
        <path d="M11 17h2" />
      </svg>
    );
  }
  if (name === "flag") {
    return (
      <svg {...common}>
        <path d="M6 20V5" />
        <path d="M8 5h10l-2 4 2 4H8V5Z" />
        <path d="M10 8h5" />
      </svg>
    );
  }
  if (name === "play") {
    return (
      <svg {...common}>
        <path d="m8 5 11 7-11 7V5Z" />
      </svg>
    );
  }
  if (name === "plus") {
    return (
      <svg {...common}>
        <path d="M12 5v14M5 12h14" />
      </svg>
    );
  }
  if (name === "search") {
    return (
      <svg {...common}>
        <circle cx="11" cy="11" r="6" />
        <path d="m16 16 4 4" />
      </svg>
    );
  }
  if (name === "people") {
    return (
      <svg {...common}>
        <path d="M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM17 12a2.5 2.5 0 1 0 0-5" />
        <path d="M3.5 19a5.5 5.5 0 0 1 11 0M14.5 15.5A4.5 4.5 0 0 1 20.5 19" />
      </svg>
    );
  }
  if (name === "coin") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="8" />
        <path d="M9 10.5c.8-1.6 5.2-1.6 6 0M9 13.5c.8 1.6 5.2 1.6 6 0M12 8v8" />
      </svg>
    );
  }
  if (name === "trophy") {
    return (
      <svg {...common}>
        <path d="M8 4h8v5a4 4 0 0 1-8 0V4Z" />
        <path d="M6 5H4v2a3 3 0 0 0 4 2.8M18 5h2v2a3 3 0 0 1-4 2.8M12 13v4M9 21h6M10 17h4" />
      </svg>
    );
  }
  if (name === "bell") {
    return (
      <svg {...common}>
        <path d="M18 9a6 6 0 1 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
        <path d="M10 21h4" />
      </svg>
    );
  }
  if (name === "shield") {
    return (
      <svg {...common}>
        <path d="M12 3 20 6v6c0 5-3.4 7.8-8 9-4.6-1.2-8-4-8-9V6l8-3Z" />
        <path d="m9 12 2 2 4-5" />
      </svg>
    );
  }
  if (name === "door") {
    return (
      <svg {...common}>
        <path d="M14 4h4v16h-4M14 12H4" />
        <path d="m8 8-4 4 4 4" />
      </svg>
    );
  }
  if (name === "grid") {
    return (
      <svg {...common}>
        <rect x="4" y="4" width="6" height="6" rx="1" />
        <rect x="14" y="4" width="6" height="6" rx="1" />
        <rect x="4" y="14" width="6" height="6" rx="1" />
        <rect x="14" y="14" width="6" height="6" rx="1" />
      </svg>
    );
  }
  if (name === "lightning") {
    return (
      <svg {...common}>
        <path d="m13 2-8 12h7l-1 8 8-12h-7l1-8Z" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="m12 3 2.5 5 5.5.8-4 3.9.9 5.5-4.9-2.6-4.9 2.6.9-5.5-4-3.9 5.5-.8L12 3Z" />
    </svg>
  );
}

function GameVisual({ game, compact = false }: { game: Game; compact?: boolean }) {
  const tileClass = compact ? "h-10 w-7 text-[10px]" : "h-14 w-10 text-xs";
  if (game.icon === "mahjong") {
    return (
      <div className="flex h-full items-center justify-center gap-2" aria-hidden="true">
        {["一", "二", "三", "发"].map((item, index) => (
          <span
            key={`${game.id}-tile-${item}`}
            className={`${tileClass} flex items-center justify-center rounded-md border border-emerald-700/20 bg-white font-semibold shadow-sm`}
            style={{ color: index === 3 ? "#b42318" : game.accent }}
          >
            {item}
          </span>
        ))}
      </div>
    );
  }
  if (game.icon === "chess") {
    return (
      <div className="grid h-full place-items-center" aria-hidden="true">
        <div className="grid h-24 w-24 grid-cols-3 grid-rows-3 rounded-md border border-stone-700/30 bg-[#e8c98f] p-1">
          {Array.from({ length: 9 }).map((_, index) => (
            <span key={`${game.id}-cell-${index}`} className="border border-stone-800/25" />
          ))}
        </div>
      </div>
    );
  }
  if (game.icon === "dice" || game.icon === "star") {
    return (
      <div className="flex h-full items-center justify-center gap-2" aria-hidden="true">
        {[1, 2, 3].map((item) => (
          <span
            key={`${game.id}-dice-${item}`}
            className="grid h-12 w-12 place-items-center rounded-md border border-slate-900/10 bg-white text-lg font-bold shadow-sm"
            style={{ color: game.accent }}
          >
            {item}
          </span>
        ))}
      </div>
    );
  }
  if (game.icon === "flag") {
    const flagCodes = ["es", "fr", "de", "cn", "jp"];
    return (
      <div className="flex h-full items-center justify-center" aria-hidden="true">
        {flagCodes.map((code, index) => (
          <span
            key={`${game.id}-flag-${code}`}
            className="grid h-14 w-12 origin-bottom place-items-center overflow-hidden rounded-md border border-slate-900/10 bg-white p-1 shadow-sm"
            style={{ transform: `translateX(${index * -7}px) rotate(${(index - 2) * 7}deg)` }}
          >
            <img className="h-8 w-10 rounded-sm object-cover" src={`https://flagcdn.com/w80/${code}.png`} alt="" />
          </span>
        ))}
      </div>
    );
  }
  if (game.id === "mobile-hall") {
    return (
      <div className="grid h-full place-items-center" aria-hidden="true">
        <div className="relative h-28 w-16 rounded-lg border-2 border-slate-800 bg-slate-950 p-1">
          <div className="grid h-full grid-cols-2 gap-1 rounded-md bg-white p-1">
            <span className="rounded bg-emerald-200" />
            <span className="rounded bg-amber-200" />
            <span className="rounded bg-red-200" />
            <span className="rounded bg-cyan-200" />
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="flex h-full items-center justify-center" aria-hidden="true">
      {["A", "K", "Q"].map((item, index) => (
        <span
          key={`${game.id}-card-${item}`}
          className="grid h-16 w-11 origin-bottom place-items-center rounded-md border border-slate-900/10 bg-white text-lg font-black shadow-sm"
          style={{
            color: index === 1 ? game.accent : "#1f2937",
            transform: `translateX(${index * -6}px) rotate(${(index - 1) * 8}deg)`,
          }}
        >
          {item}
        </span>
      ))}
    </div>
  );
}

function TablePreview({ game, table }: { game: Game; table: TableState }) {
  const tableAccent = { borderColor: game.accent, boxShadow: `0 18px 38px ${game.accent}20` };

  return (
    <section className="min-h-[390px] rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-500">当前桌台</div>
          <h2 className="text-2xl font-bold text-slate-950">{table.gameName}</h2>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center text-xs text-slate-500">
          <div className="rounded-md border border-slate-200 px-3 py-2">
            <div className="text-base font-bold text-slate-950">{table.roomName}</div>
            房间
          </div>
          <div className="rounded-md border border-slate-200 px-3 py-2">
            <div className="text-base font-bold text-slate-950">{table.tableNo}</div>
            桌号
          </div>
          <div className="rounded-md border border-slate-200 px-3 py-2">
            <div className="text-base font-bold text-slate-950">
              {table.ready}/{table.seats}
            </div>
            就绪
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_220px]">
        <div className="relative min-h-[260px] overflow-hidden rounded-lg border-2 bg-[#116149] p-4" style={tableAccent}>
          <div className="absolute inset-4 rounded-lg border border-white/15" />
          <div className="absolute left-1/2 top-4 -translate-x-1/2 rounded-md bg-white/95 px-3 py-2 text-xs font-semibold text-slate-700">
            对手 2
          </div>
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-md bg-white px-3 py-2 text-xs font-semibold text-slate-900">
            我方已准备
          </div>
          <div className="absolute left-4 top-1/2 -translate-y-1/2 rounded-md bg-white/90 px-3 py-2 text-xs font-semibold text-slate-700">
            队友
          </div>
          <div className="absolute right-4 top-1/2 -translate-y-1/2 rounded-md bg-white/90 px-3 py-2 text-xs font-semibold text-slate-700">
            对手 1
          </div>
          <div className="absolute inset-0 grid place-items-center">
            {game.category === "mahjong" ? (
              <div className="grid gap-2">
                <div className="flex justify-center gap-1">
                  {["一", "三", "五", "七", "东", "中"].map((tile) => (
                    <span key={`table-top-${tile}`} className="grid h-9 w-7 place-items-center rounded border bg-white text-xs font-bold text-emerald-800">
                      {tile}
                    </span>
                  ))}
                </div>
                <div className="grid h-20 w-36 place-items-center rounded-lg border border-white/25 bg-emerald-950/20 text-white">
                  摸牌区
                </div>
                <div className="flex justify-center gap-1">
                  {["二", "四", "六", "八", "南", "发"].map((tile) => (
                    <span key={`table-bottom-${tile}`} className="grid h-10 w-8 place-items-center rounded border bg-white text-sm font-bold text-red-700">
                      {tile}
                    </span>
                  ))}
                </div>
              </div>
            ) : game.category === "board" ? (
              <div className="grid h-40 w-40 grid-cols-8 grid-rows-8 rounded-md bg-[#e8c98f] p-1">
                {Array.from({ length: 64 }).map((_, index) => (
                  <span
                    key={`board-${index}`}
                    className={`border border-stone-900/25 ${index % 9 === 0 || index % 7 === 0 ? "grid place-items-center" : ""}`}
                  >
                    {index % 9 === 0 ? (
                      <span className="h-4 w-4 rounded-full bg-red-700" />
                    ) : index % 7 === 0 ? (
                      <span className="h-4 w-4 rounded-full bg-slate-800" />
                    ) : null}
                  </span>
                ))}
              </div>
            ) : (
              <div className="flex items-end justify-center gap-2">
                {["3", "4", "5", "6", "7", "8", "9"].map((card, index) => (
                  <span
                    key={`hand-${card}`}
                    className="grid h-20 w-12 origin-bottom place-items-center rounded-md border border-slate-200 bg-white text-lg font-black shadow"
                    style={{ color: index % 2 ? "#b42318" : "#111827", transform: `rotate(${(index - 3) * 4}deg)` }}
                  >
                    {card}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="grid content-start gap-3">
          <div className="rounded-lg border border-slate-200 p-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <Icon name="shield" />
              健康休闲
            </div>
            <div className="mt-3 grid gap-2 text-sm text-slate-600">
              <div className="flex items-center justify-between">
                <span>局时提醒</span>
                <strong className="text-slate-950">45 分钟</strong>
              </div>
              <div className="flex items-center justify-between">
                <span>对局货币</span>
                <strong className="text-slate-950">茶豆</strong>
              </div>
              <div className="flex items-center justify-between">
                <span>旁观席</span>
                <strong className="text-slate-950">开放</strong>
              </div>
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 p-3">
            <div className="text-sm font-semibold text-slate-700">快捷语</div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              {["准备", "漂亮", "再来一局", "稍等"].map((item) => (
                <button key={item} type="button" className="rounded-md border border-slate-200 px-2 py-1 text-slate-700 hover:bg-slate-50">
                  {item}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function StatLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 py-2 text-sm last:border-b-0">
      <span className="text-slate-500">{label}</span>
      <strong className="text-slate-950">{value}</strong>
    </div>
  );
}

export default function GameLobbyClient() {
  const [selectedCategory, setSelectedCategory] = useState<CategoryId>("all");
  const [selectedGameId, setSelectedGameId] = useState("shuangkou");
  const [selectedRoomId, setSelectedRoomId] = useState("shuangkou-rookie");
  const [query, setQuery] = useState("");
  const [wallet, setWallet] = useState(28600);
  const [matching, setMatching] = useState(false);
  const [privateRoomOpen, setPrivateRoomOpen] = useState(false);
  const [privateRoomName, setPrivateRoomName] = useState("好友小桌");
  const [privateRoomStake, setPrivateRoomStake] = useState("低倍");
  const [customRooms, setCustomRooms] = useState<Room[]>([]);
  const matchTimeoutRef = useRef<number | null>(null);
  const [table, setTable] = useState<TableState>({
    gameName: "千变双扣",
    roomName: "新手场",
    tableNo: 318,
    seats: 4,
    ready: 1,
  });

  const normalizedQuery = query.trim().toLowerCase();
  const visibleGames = useMemo(() => {
    return games
      .filter((game) => selectedCategory === "all" || game.category === selectedCategory)
      .filter((game) => {
        if (!normalizedQuery) return true;
        const haystack = `${game.name} ${game.kind} ${game.tags.join(" ")}`.toLowerCase();
        return haystack.includes(normalizedQuery);
      })
      .sort((a, b) => b.heat - a.heat);
  }, [normalizedQuery, selectedCategory]);

  const selectedGame =
    visibleGames.find((game) => game.id === selectedGameId) ??
    visibleGames[0] ??
    games.find((game) => game.id === selectedGameId) ??
    games[0];
  const selectedRooms = useMemo(() => buildRoomsForGame(selectedGame, customRooms), [customRooms, selectedGame]);
  const selectedRoom = selectedRooms.find((room) => room.id === selectedRoomId) ?? selectedRooms[0];
  const totalOnline = games.reduce((sum, game) => sum + game.online, 0);
  const hotEntries = useMemo(() => [...games].sort((a, b) => b.heat - a.heat).slice(0, 3), []);

  useEffect(() => {
    return () => {
      if (matchTimeoutRef.current !== null) {
        window.clearTimeout(matchTimeoutRef.current);
      }
    };
  }, []);

  const openPlayableGame = useCallback((gameId: string) => {
    if (gameId !== "bufuzai" || typeof window === "undefined") return false;
    window.location.assign(new URL("/bufuzai", window.location.origin).toString());
    return true;
  }, []);

  const startMatch = useCallback(
    (room: Room = selectedRoom) => {
      if (!room) return;
      if (openPlayableGame(room.gameId)) return;
      if (matchTimeoutRef.current !== null) {
        window.clearTimeout(matchTimeoutRef.current);
      }
      setSelectedGameId(room.gameId);
      setSelectedRoomId(room.id);
      setMatching(true);
      matchTimeoutRef.current = window.setTimeout(() => {
        const game = games.find((item) => item.id === room.gameId) ?? selectedGame;
        setTable({
          gameName: game.name,
          roomName: room.name,
          tableNo: 100 + Math.floor(Math.random() * 860),
          seats: game.players.includes("2") || game.players.includes("1v1") ? 2 : 4,
          ready: 1,
        });
        setWallet((current) => Math.max(0, current - (room.access === "coins" ? Math.min(room.minCoins, 1200) : 0)));
        setMatching(false);
      }, 760);
    },
    [openPlayableGame, selectedGame, selectedRoom],
  );

  const createPrivateRoom = useCallback(() => {
    const roomId = `${selectedGame.id}-custom-${Date.now()}`;
    const createdRoom: Room = {
      id: roomId,
      gameId: selectedGame.id,
      name: privateRoomName.trim() || "好友小桌",
      level: "私密",
      online: 1,
      tables: 1,
      minCoins: 0,
      speed: "不限",
      stake: privateRoomStake,
      access: "friend",
    };
    setCustomRooms((current) => [createdRoom, ...current].slice(0, 8));
    setSelectedRoomId(roomId);
    setTable({
      gameName: selectedGame.name,
      roomName: createdRoom.name,
      tableNo: 900 + Math.floor(Math.random() * 90),
      seats: selectedGame.players.includes("2") || selectedGame.players.includes("1v1") ? 2 : 4,
      ready: 1,
    });
    setPrivateRoomOpen(false);
  }, [privateRoomName, privateRoomStake, selectedGame]);

  return (
    <main className="min-h-screen bg-[#f4f7f1] text-slate-950">
      <header className="border-b border-emerald-900 bg-[#123f32] text-white">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-4 px-4 py-3 lg:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#f4bf45] text-lg font-black text-[#123f32]">
              茶
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-xl font-black">茶趣棋牌大厅</h1>
              <div className="text-xs text-emerald-100">休闲棋牌 · 在线 {formatNumber(totalOnline)}</div>
            </div>
          </div>
          <nav className="flex flex-1 flex-wrap items-center gap-2 text-sm">
            {["大厅", "赛事", "好友", "战绩"].map((item, index) => (
              <button
                key={item}
                type="button"
                className={`rounded-md px-3 py-2 font-semibold transition ${
                  index === 0 ? "bg-white text-[#123f32]" : "text-emerald-50 hover:bg-white/10"
                }`}
              >
                {item}
              </button>
            ))}
          </nav>
          <div className="flex items-center gap-2 text-sm">
            <div className="flex items-center gap-2 rounded-md bg-white/10 px-3 py-2">
              <Icon name="coin" />
              <span className="font-semibold">{formatNumber(wallet)}</span>
            </div>
            <button type="button" className="rounded-md bg-[#f4bf45] px-3 py-2 font-bold text-[#123f32] hover:bg-[#ffd66f]" title="打开个人中心">
              玩家中心
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1500px] gap-4 px-4 py-4 lg:grid-cols-[230px_minmax(0,1fr)_310px] lg:px-6">
        <aside className="space-y-4">
          <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
            <div className="px-1 pb-2 text-sm font-bold text-slate-700">游戏分类</div>
            <div className="grid gap-1">
              {categoryTabs.map((tab) => {
                const count =
                  tab.id === "all" ? games.length : games.filter((game) => game.category === tab.id).length;
                const selected = selectedCategory === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    className={`flex items-center justify-between rounded-md px-3 py-2 text-left text-sm font-semibold transition ${
                      selected ? "bg-emerald-700 text-white" : "text-slate-700 hover:bg-slate-100"
                    }`}
                    onClick={() => setSelectedCategory(tab.id)}
                  >
                    <span className="flex items-center gap-2">
                      <Icon name={tab.icon} />
                      {tab.label}
                    </span>
                    <span className={selected ? "text-emerald-100" : "text-slate-400"}>{count}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-700">
              <Icon name="trophy" />
              今日任务
            </div>
            <div className="mt-3 grid gap-2">
              {tasks.map((task) => (
                <div key={task.label} className="border-b border-slate-100 pb-2 text-sm last:border-b-0 last:pb-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-800">{task.label}</span>
                    <span className={`rounded px-2 py-0.5 text-xs ${task.done ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
                      {task.done ? "已完成" : "进行中"}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">{task.reward}</div>
                </div>
              ))}
            </div>
          </section>
        </aside>

        <div className="grid min-w-0 gap-4">
          <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center">
              <label className="relative block">
                <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="h-10 w-full rounded-md border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm outline-none focus:border-emerald-600 focus:bg-white"
                  placeholder="搜索游戏、规则、地区"
                />
              </label>
              <button
                type="button"
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-red-700 px-4 text-sm font-bold text-white hover:bg-red-800 disabled:opacity-60"
                onClick={() => startMatch(selectedRoom)}
                disabled={matching}
                title="快速开始匹配"
              >
                <Icon name="play" />
                {matching ? "匹配中" : "快速开始"}
              </button>
              <button
                type="button"
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-emerald-700 px-4 text-sm font-bold text-emerald-800 hover:bg-emerald-50"
                onClick={() => setPrivateRoomOpen(true)}
                title="创建好友房"
              >
                <Icon name="plus" />
                好友房
              </button>
            </div>
          </section>

          <TablePreview game={selectedGame} table={table} />

          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {visibleGames.map((game) => {
              const selected = game.id === selectedGame.id;
              return (
                <button
                  key={game.id}
                  type="button"
                  className={`min-h-[214px] rounded-lg border bg-gradient-to-br p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${
                    selected ? "border-emerald-700 ring-2 ring-emerald-700/20" : "border-slate-200"
                  } ${game.tone}`}
                  onClick={() => {
                    setSelectedGameId(game.id);
                    setSelectedRoomId(`${game.id}-rookie`);
                  }}
                >
                  <div className="grid h-full grid-rows-[92px_auto] gap-3">
                    <div className="rounded-lg border border-white/70 bg-white/70">
                      <GameVisual game={game} compact />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-lg font-black text-slate-950">{game.name}</div>
                          <div className="text-sm text-slate-600">
                            {game.kind} · {game.players}
                          </div>
                        </div>
                        <span className="rounded-md px-2 py-1 text-xs font-bold text-white" style={{ backgroundColor: game.accent }}>
                          {game.heat}
                        </span>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600">
                        <span className="rounded border border-white/70 bg-white/70 px-2 py-1">
                          在线 {formatNumber(game.online)}
                        </span>
                        <span className="rounded border border-white/70 bg-white/70 px-2 py-1">
                          房间 {game.rooms}
                        </span>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-1">
                        {game.tags.slice(0, 3).map((tag) => (
                          <span key={`${game.id}-${tag}`} className="rounded bg-white/70 px-2 py-0.5 text-xs font-semibold text-slate-600">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
            {visibleGames.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
                没有匹配的游戏
              </div>
            ) : null}
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-lg font-black text-slate-950">{selectedGame.name} 房间</h2>
                <div className="text-sm text-slate-500">
                  {selectedGame.kind} · {selectedGame.pace} · 在线 {formatNumber(selectedGame.online)}
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
                <Icon name="people" />
                {selectedRooms.length} 个入口
              </div>
            </div>
            <div className="mt-3 grid gap-2">
              {selectedRooms.map((room) => {
                const selected = room.id === selectedRoom.id;
                return (
                  <div
                    key={room.id}
                    className={`grid gap-3 rounded-lg border p-3 md:grid-cols-[1fr_auto] md:items-center ${
                      selected ? "border-emerald-700 bg-emerald-50" : "border-slate-200 bg-white"
                    }`}
                  >
                    <button
                      type="button"
                      className="grid min-w-0 gap-2 text-left"
                      onClick={() => {
                        setSelectedRoomId(room.id);
                        setTable((current) => ({
                          ...current,
                          gameName: selectedGame.name,
                          roomName: room.name,
                          seats: selectedGame.players.includes("2") || selectedGame.players.includes("1v1") ? 2 : 4,
                        }));
                      }}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-base font-black text-slate-950">{room.name}</span>
                        <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">{room.level}</span>
                        <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">{accessLabel(room.access)}</span>
                      </div>
                      <div className="grid gap-2 text-xs text-slate-500 sm:grid-cols-4">
                        <span>在线 {formatNumber(room.online)}</span>
                        <span>桌台 {room.tables}</span>
                        <span>底分 {room.stake}</span>
                        <span>出牌 {room.speed}</span>
                      </div>
                    </button>
                    <button
                      type="button"
                      className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-slate-950 px-3 text-sm font-bold text-white hover:bg-emerald-800 disabled:opacity-60"
                      onClick={() => startMatch(room)}
                      disabled={matching}
                      title={`${room.name} 入座`}
                    >
                      <Icon name="door" />
                      入座
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        <aside className="space-y-4">
          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-lg bg-[#123f32] font-black text-white">游</div>
              <div className="min-w-0">
                <div className="truncate font-black text-slate-950">游客 0521</div>
                <div className="text-xs text-slate-500">白银段位 · 连续登录 5 天</div>
              </div>
            </div>
            <div className="mt-4">
              <StatLine label="茶豆余额" value={formatNumber(wallet)} />
              <StatLine label="胜率" value="56.8%" />
              <StatLine label="本周局数" value="38" />
              <StatLine label="信用状态" value="正常" />
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-black text-slate-800">
                <Icon name="lightning" />
                匹配状态
              </div>
              <span className={`rounded px-2 py-1 text-xs font-bold ${matching ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-800"}`}>
                {matching ? "排队中" : "空闲"}
              </span>
            </div>
            <div className="mt-4 rounded-lg border border-slate-200 p-3">
              <div className="text-sm font-bold text-slate-950">{selectedGame.name}</div>
              <div className="mt-1 text-sm text-slate-500">{selectedRoom?.name ?? "新手场"}</div>
              <div className="mt-3 h-2 overflow-hidden rounded bg-slate-100">
                <div className={`h-full rounded bg-red-700 ${matching ? "w-2/3" : "w-1/4"}`} />
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-black text-slate-800">
              <Icon name="bell" />
              公告
            </div>
            <div className="mt-3 grid gap-3">
              {notices.map((notice) => (
                <div key={notice} className="border-b border-slate-100 pb-3 text-sm leading-6 text-slate-600 last:border-b-0 last:pb-0">
                  {notice}
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-black text-slate-800">
              <Icon name="star" />
              热门入口
            </div>
            <div className="mt-3 grid gap-2">
              {hotEntries.map((game) => (
                <button
                  key={`hot-${game.id}`}
                  type="button"
                  className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-left hover:bg-slate-50"
                  onClick={() => {
                    setSelectedGameId(game.id);
                    setSelectedRoomId(`${game.id}-rookie`);
                  }}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Icon
                      name={
                        game.icon === "mahjong"
                          ? "tile"
                          : game.icon === "chess"
                            ? "chess"
                            : game.icon === "dice"
                              ? "dice"
                              : game.icon === "flag"
                                ? "flag"
                                : "cards"
                      }
                    />
                    <span className="truncate text-sm font-bold text-slate-800">{game.name}</span>
                  </span>
                  <span className="text-xs text-slate-500">{formatNumber(game.online)}</span>
                </button>
              ))}
            </div>
          </section>
        </aside>
      </div>

      {privateRoomOpen ? (
        <div className="fixed inset-0 z-[2147483100] grid place-items-center bg-slate-950/55 p-4">
          <section className="w-full max-w-md rounded-lg bg-white p-4 shadow-2xl">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-black text-slate-950">创建好友房</h2>
              <button
                type="button"
                className="grid h-8 w-8 place-items-center rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50"
                onClick={() => setPrivateRoomOpen(false)}
                aria-label="关闭"
                title="关闭"
              >
                ×
              </button>
            </div>
            <div className="mt-4 grid gap-3">
              <label className="grid gap-1 text-sm font-semibold text-slate-700">
                房间名
                <input
                  value={privateRoomName}
                  onChange={(event) => setPrivateRoomName(event.target.value)}
                  className="h-10 rounded-md border border-slate-200 px-3 font-normal outline-none focus:border-emerald-600"
                />
              </label>
              <label className="grid gap-1 text-sm font-semibold text-slate-700">
                底分
                <select
                  value={privateRoomStake}
                  onChange={(event) => setPrivateRoomStake(event.target.value)}
                  className="h-10 rounded-md border border-slate-200 px-3 font-normal outline-none focus:border-emerald-600"
                >
                  <option>低倍</option>
                  <option>中倍</option>
                  <option>高倍</option>
                  <option>自定义</option>
                </select>
              </label>
              <div className="rounded-lg border border-slate-200 p-3">
                <div className="text-sm font-bold text-slate-950">{selectedGame.name}</div>
                <div className="mt-1 text-sm text-slate-500">
                  {selectedGame.kind} · {selectedGame.players}
                </div>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                className="h-10 rounded-md border border-slate-200 font-bold text-slate-700 hover:bg-slate-50"
                onClick={() => setPrivateRoomOpen(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-emerald-700 font-bold text-white hover:bg-emerald-800"
                onClick={createPrivateRoom}
                title="创建好友房"
              >
                <Icon name="plus" />
                创建
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
