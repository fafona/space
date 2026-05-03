"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import TankBattleIcon from "@/components/TankBattleIcon";
import { hasSupabaseEnv, supabase } from "@/lib/supabase";

type Direction = "up" | "down" | "left" | "right";
type GameMode = "solo" | "local" | "online-host" | "online-guest";
type Terrain = 0 | 1 | 2 | 3 | 4 | 5;
type PowerupType = "helmet" | "star" | "bomb" | "clock" | "shovel" | "tank";
type GameStatus = "ready" | "playing" | "paused" | "stage-clear" | "game-over";

type InputState = {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  fire: boolean;
};

type Tank = {
  id: string;
  kind: "player" | "enemy";
  player?: 1 | 2;
  active?: boolean;
  x: number;
  y: number;
  dir: Direction;
  speed: number;
  lives: number;
  power: number;
  score: number;
  cooldown: number;
  invincible: number;
  aiTimer: number;
  stuckTimer: number;
  color: string;
};

type Bullet = {
  id: string;
  ownerId: string;
  ownerKind: "player" | "enemy";
  player?: 1 | 2;
  x: number;
  y: number;
  dir: Direction;
  speed: number;
  power: number;
};

type Powerup = {
  id: string;
  type: PowerupType;
  x: number;
  y: number;
  expiresAt: number;
};

type Spark = {
  id: string;
  x: number;
  y: number;
  radius: number;
  expiresAt: number;
  color: string;
};

type GameState = {
  status: GameStatus;
  mode: GameMode;
  stage: number;
  time: number;
  map: Terrain[][];
  players: Tank[];
  enemies: Tank[];
  bullets: Bullet[];
  powerups: Powerup[];
  sparks: Spark[];
  totalEnemies: number;
  spawnedEnemies: number;
  destroyedEnemies: number;
  nextSpawnAt: number;
  baseAlive: boolean;
  freezeUntil: number;
  shovelUntil: number;
  stageClearAt: number;
  message: string;
  highScore: number;
};

type UiState = {
  status: GameStatus;
  mode: GameMode;
  stage: number;
  totalScore: number;
  highScore: number;
  p1Lives: number;
  p2Lives: number;
  p1Power: number;
  p2Power: number;
  enemiesLeft: number;
  message: string;
  roomId: string;
  onlineRole: OnlineRole;
  peers: number;
  networkStatus: string;
};

type OnlineRole = "none" | "host" | "guest";

type TankBattleClientProps = {
  subtitle?: string;
};

const GRID_SIZE = 13;
const TILE_SIZE = 32;
const CANVAS_SIZE = GRID_SIZE * TILE_SIZE;
const TANK_SIZE = 0.78;
const BULLET_SIZE = 0.12;
const MAX_STAGE = 35;
const LOCAL_HIGH_SCORE_KEY = "faolla:tank-battle:high-score:v1";
const emptyInput: InputState = { up: false, down: false, left: false, right: false, fire: false };
const directionVectors: Record<Direction, { x: number; y: number }> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};
const allDirections: Direction[] = ["up", "down", "left", "right"];
const oppositeDirection: Record<Direction, Direction> = {
  up: "down",
  down: "up",
  left: "right",
  right: "left",
};
const powerupLabels: Record<PowerupType, string> = {
  helmet: "盾",
  star: "星",
  bomb: "爆",
  clock: "停",
  shovel: "墙",
  tank: "命",
};
const levelTemplates = [
  [
    ".....B.B.....",
    "..B..B.B..B..",
    "..B..B.B..B..",
    ".....B.B.....",
    ".BB...W...BB.",
    ".....WWW.....",
    ".SS.......SS.",
    ".....FFF.....",
    "..B..B.B..B..",
    "..B..B.B..B..",
    ".....B.B.....",
    ".....BBB.....",
    ".....B.B.....",
  ],
  [
    "..B...S...B..",
    "..B...S...B..",
    "BBB.......BBB",
    ".....WWW.....",
    ".S.B.....B.S.",
    "...B.FFF.B...",
    "...B.FFF.B...",
    "...B.FFF.B...",
    ".S.B.....B.S.",
    ".....WWW.....",
    "BBB.......BBB",
    ".....BBB.....",
    ".....B.B.....",
  ],
  [
    "B...B...B...B",
    "B.W.B.S.B.W.B",
    "...B.....B...",
    "SSS...B...SSS",
    ".....BBB.....",
    "..FFF...FFF..",
    "..F.......F..",
    "..FFF...FFF..",
    ".....BBB.....",
    "SSS...B...SSS",
    "...B.....B...",
    ".....BBB.....",
    ".....B.B.....",
  ],
  [
    "...B.....B...",
    ".BBB.S.S.BBB.",
    ".....S.S.....",
    "WW...B.B...WW",
    "WW.B.....B.WW",
    "...B.FFF.B...",
    ".S...F.F...S.",
    "...B.FFF.B...",
    "WW.B.....B.WW",
    "WW...B.B...WW",
    ".....S.S.....",
    ".....BBB.....",
    ".....B.B.....",
  ],
  [
    ".B.B.B.B.B.B.",
    ".............",
    "SS..WWW..SS..",
    "....WWW......",
    ".B.B...B.B.B.",
    "....FFF......",
    "SS..F.F..SS..",
    "....FFF......",
    ".B.B...B.B.B.",
    "....WWW......",
    "SS..WWW..SS..",
    ".....BBB.....",
    ".....B.B.....",
  ],
  [
    "..SS.....SS..",
    "..B..BBB..B..",
    "..B..B.B..B..",
    "WWW.......WWW",
    "....FFFFF....",
    ".BB.......BB.",
    ".B...SSS...B.",
    ".BB.......BB.",
    "....FFFFF....",
    "WWW.......WWW",
    "..B..B.B..B..",
    ".....BBB.....",
    ".....B.B.....",
  ],
];

function cloneInput(input: InputState): InputState {
  return {
    up: input.up,
    down: input.down,
    left: input.left,
    right: input.right,
    fire: input.fire,
  };
}

function mergeInput(first: InputState, second: InputState): InputState {
  return {
    up: first.up || second.up,
    down: first.down || second.down,
    left: first.left || second.left,
    right: first.right || second.right,
    fire: first.fire || second.fire,
  };
}

function normalizeRoomId(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
}

function createRoomId() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let id = "";
  const values = new Uint32Array(6);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(values);
    for (const value of values) id += alphabet[value % alphabet.length];
    return id;
  }
  for (let index = 0; index < 6; index += 1) {
    id += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return id;
}

function readHighScore() {
  if (typeof window === "undefined") return 0;
  try {
    const raw = window.localStorage.getItem(LOCAL_HIGH_SCORE_KEY);
    const parsed = raw ? Number.parseInt(raw, 10) : 0;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  } catch {
    return 0;
  }
}

function writeHighScore(score: number) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LOCAL_HIGH_SCORE_KEY, String(Math.max(0, Math.round(score))));
  } catch {
    // Ignore browser storage failures.
  }
}

function seededValue(stage: number, x: number, y: number) {
  const raw = Math.sin(stage * 83.17 + x * 19.9 + y * 37.31) * 10000;
  return raw - Math.floor(raw);
}

function createStageMap(stage: number): Terrain[][] {
  const template = levelTemplates[(stage - 1) % levelTemplates.length];
  const map: Terrain[][] = template.map((row, y) =>
    Array.from(row).map((cell, x) => {
      if (cell === "B") return 1 as Terrain;
      if (cell === "S") return 2 as Terrain;
      if (cell === "W") return 3 as Terrain;
      if (cell === "F") return 4 as Terrain;
      if (cell === "I") return 5 as Terrain;
      if (stage > 6 && y > 1 && y < 10 && x > 0 && x < 12 && seededValue(stage, x, y) > 0.965) {
        return seededValue(stage + 3, x, y) > 0.7 ? 2 : 1;
      }
      return 0 as Terrain;
    }),
  );

  [
    [5, 11],
    [6, 11],
    [7, 11],
    [5, 12],
    [7, 12],
  ].forEach(([x, y]) => {
    map[y][x] = 1;
  });
  [
    [0, 0],
    [6, 0],
    [12, 0],
    [4, 11],
    [8, 11],
    [6, 12],
  ].forEach(([x, y]) => {
    map[y][x] = 0;
  });
  return map;
}

function createPlayer(player: 1 | 2, active: boolean): Tank {
  return {
    id: `player-${player}`,
    kind: "player",
    player,
    active,
    x: player === 1 ? 4.05 : 8.05,
    y: 11.55,
    dir: "up",
    speed: 2.65,
    lives: 3,
    power: 1,
    score: 0,
    cooldown: 0,
    invincible: 3,
    aiTimer: 0,
    stuckTimer: 0,
    color: player === 1 ? "#10b981" : "#f59e0b",
  };
}

function createGameState(mode: GameMode, stage = 1, previousPlayers?: Tank[], highScore = readHighScore()): GameState {
  const twoPlayers = mode === "local" || mode === "online-host" || mode === "online-guest";
  const p1 = createPlayer(1, true);
  const p2 = createPlayer(2, twoPlayers);
  if (previousPlayers?.[0]) {
    p1.lives = Math.max(1, previousPlayers[0].lives);
    p1.power = Math.max(1, previousPlayers[0].power);
    p1.score = Math.max(0, previousPlayers[0].score);
  }
  if (previousPlayers?.[1]) {
    p2.lives = Math.max(twoPlayers ? 1 : 0, previousPlayers[1].lives);
    p2.power = Math.max(1, previousPlayers[1].power);
    p2.score = Math.max(0, previousPlayers[1].score);
  }
  return {
    status: "ready",
    mode,
    stage,
    time: 0,
    map: createStageMap(stage),
    players: [p1, p2],
    enemies: [],
    bullets: [],
    powerups: [],
    sparks: [],
    totalEnemies: Math.min(20, 12 + Math.floor(stage / 2)),
    spawnedEnemies: 0,
    destroyedEnemies: 0,
    nextSpawnAt: 0.5,
    baseAlive: true,
    freezeUntil: 0,
    shovelUntil: 0,
    stageClearAt: 0,
    message: mode === "online-guest" ? "等待房主开始" : "选择模式后开始",
    highScore,
  };
}

function tileAt(map: Terrain[][], x: number, y: number) {
  if (x < 0 || y < 0 || x >= GRID_SIZE || y >= GRID_SIZE) return 2 as Terrain;
  return map[y][x];
}

function isBlockingTerrain(tile: Terrain) {
  return tile === 1 || tile === 2 || tile === 3;
}

function rectsOverlap(
  leftA: number,
  topA: number,
  rightA: number,
  bottomA: number,
  leftB: number,
  topB: number,
  rightB: number,
  bottomB: number,
) {
  return leftA < rightB && rightA > leftB && topA < bottomB && bottomA > topB;
}

function rectHitsBase(x: number, y: number, size: number, baseAlive: boolean) {
  if (!baseAlive) return false;
  return rectsOverlap(x, y, x + size, y + size, 6.08, 12.08, 6.92, 12.92);
}

function rectHitsTerrain(map: Terrain[][], x: number, y: number, size: number, baseAlive: boolean) {
  if (x < 0 || y < 0 || x + size > GRID_SIZE || y + size > GRID_SIZE) return true;
  if (rectHitsBase(x, y, size, baseAlive)) return true;
  const minX = Math.max(0, Math.floor(x));
  const maxX = Math.min(GRID_SIZE - 1, Math.floor(x + size - 0.001));
  const minY = Math.max(0, Math.floor(y));
  const maxY = Math.min(GRID_SIZE - 1, Math.floor(y + size - 0.001));
  for (let ty = minY; ty <= maxY; ty += 1) {
    for (let tx = minX; tx <= maxX; tx += 1) {
      if (isBlockingTerrain(map[ty][tx])) return true;
    }
  }
  return false;
}

function tankCenter(tank: Tank) {
  return { x: tank.x + TANK_SIZE / 2, y: tank.y + TANK_SIZE / 2 };
}

function addSpark(state: GameState, x: number, y: number, radius: number, color = "#fbbf24") {
  state.sparks.push({
    id: `spark-${state.time}-${Math.random().toString(16).slice(2)}`,
    x,
    y,
    radius,
    color,
    expiresAt: state.time + 0.28,
  });
}

function spawnPowerup(state: GameState, x: number, y: number) {
  const types: PowerupType[] = ["helmet", "star", "bomb", "clock", "shovel", "tank"];
  const index = Math.floor(seededValue(state.stage + Math.round(state.time * 10), x, y) * types.length) % types.length;
  state.powerups = state.powerups.filter((item) => item.expiresAt > state.time);
  state.powerups.push({
    id: `power-${state.time}-${index}`,
    type: types[index],
    x: Math.max(0.5, Math.min(11.5, Math.round(x) + 0.08)),
    y: Math.max(1.5, Math.min(10.5, Math.round(y) + 0.08)),
    expiresAt: state.time + 13,
  });
}

function applyPowerup(state: GameState, player: Tank, type: PowerupType) {
  if (type === "helmet") {
    player.invincible = Math.max(player.invincible, 8);
    state.message = `${player.player === 1 ? "玩家一" : "玩家二"}获得护盾`;
  } else if (type === "star") {
    player.power = Math.min(4, player.power + 1);
    player.score += 300;
    state.message = `${player.player === 1 ? "玩家一" : "玩家二"}火力升级`;
  } else if (type === "bomb") {
    state.enemies.forEach((enemy) => {
      addSpark(state, enemy.x + 0.4, enemy.y + 0.4, 0.7, "#fb7185");
    });
    player.score += state.enemies.length * 400;
    state.destroyedEnemies += state.enemies.length;
    state.enemies = [];
    state.message = "清屏炸弹";
  } else if (type === "clock") {
    state.freezeUntil = state.time + 8;
    state.message = "敌军暂停";
  } else if (type === "shovel") {
    state.shovelUntil = state.time + 12;
    state.message = "基地钢墙保护";
  } else if (type === "tank") {
    player.lives += 1;
    state.message = `${player.player === 1 ? "玩家一" : "玩家二"}增加生命`;
  }
}

function respawnPlayer(state: GameState, player: Tank) {
  player.x = player.player === 1 ? 4.05 : 8.05;
  player.y = 11.55;
  player.dir = "up";
  player.cooldown = 0.6;
  player.invincible = 3;
}

function damagePlayer(state: GameState, player: Tank) {
  if (!player.active || player.invincible > 0) return;
  player.lives -= 1;
  addSpark(state, player.x + 0.4, player.y + 0.4, 0.8, "#fde047");
  if (player.lives > 0) {
    player.power = Math.max(1, player.power - 1);
    respawnPlayer(state, player);
  } else {
    player.active = false;
    state.message = `${player.player === 1 ? "玩家一" : "玩家二"}被击毁`;
  }
  if (!state.players.some((item) => item.active && item.lives > 0)) {
    state.status = "game-over";
    state.message = "基地失守";
  }
}

function activeTankRects(state: GameState, tank: Tank, x: number, y: number) {
  const tanks = [...state.players.filter((item) => item.active), ...state.enemies];
  return tanks.some((other) => {
    if (other.id === tank.id) return false;
    return rectsOverlap(x, y, x + TANK_SIZE, y + TANK_SIZE, other.x, other.y, other.x + TANK_SIZE, other.y + TANK_SIZE);
  });
}

function tryMoveTank(state: GameState, tank: Tank, dx: number, dy: number) {
  const nextX = tank.x + dx;
  const nextY = tank.y + dy;
  if (rectHitsTerrain(state.map, nextX, nextY, TANK_SIZE, state.baseAlive)) return false;
  if (activeTankRects(state, tank, nextX, nextY)) return false;
  tank.x = nextX;
  tank.y = nextY;
  return true;
}

function inputDirection(input: InputState): Direction | null {
  if (input.up) return "up";
  if (input.down) return "down";
  if (input.left) return "left";
  if (input.right) return "right";
  return null;
}

function shoot(state: GameState, tank: Tank) {
  if (tank.cooldown > 0) return;
  const existing = state.bullets.filter((bullet) => bullet.ownerId === tank.id).length;
  const maxBullets = tank.kind === "player" && tank.power >= 3 ? 2 : 1;
  if (existing >= maxBullets) return;
  const vector = directionVectors[tank.dir];
  const center = tankCenter(tank);
  state.bullets.push({
    id: `bullet-${state.time}-${tank.id}-${Math.random().toString(16).slice(2)}`,
    ownerId: tank.id,
    ownerKind: tank.kind,
    player: tank.player,
    x: center.x + vector.x * 0.48 - BULLET_SIZE / 2,
    y: center.y + vector.y * 0.48 - BULLET_SIZE / 2,
    dir: tank.dir,
    speed: tank.kind === "player" ? 7.2 + tank.power * 0.45 : 5.2,
    power: tank.kind === "player" ? tank.power : 1,
  });
  tank.cooldown = tank.kind === "player" ? Math.max(0.28, 0.52 - tank.power * 0.06) : 1.05;
}

function updatePlayer(state: GameState, player: Tank, input: InputState, dt: number) {
  if (!player.active || player.lives <= 0) return;
  player.cooldown = Math.max(0, player.cooldown - dt);
  player.invincible = Math.max(0, player.invincible - dt);
  const dir = inputDirection(input);
  if (dir) {
    player.dir = dir;
    const vector = directionVectors[dir];
    const moved = tryMoveTank(state, player, vector.x * player.speed * dt, vector.y * player.speed * dt);
    if (!moved) {
      const slideX = Math.abs(vector.x) > 0 ? 0 : Math.round(player.x) - player.x;
      const slideY = Math.abs(vector.y) > 0 ? 0 : Math.round(player.y) - player.y;
      if (Math.abs(slideX) < 0.08) player.x += slideX * 0.22;
      if (Math.abs(slideY) < 0.08) player.y += slideY * 0.22;
    }
  }
  if (input.fire) shoot(state, player);
}

function chooseEnemyDirection(state: GameState, enemy: Tank) {
  const center = tankCenter(enemy);
  const target = state.baseAlive ? { x: 6.5, y: 12.5 } : tankCenter(state.players[0]);
  const preferred: Direction[] =
    Math.abs(target.x - center.x) > Math.abs(target.y - center.y)
      ? [target.x > center.x ? "right" : "left", target.y > center.y ? "down" : "up"]
      : [target.y > center.y ? "down" : "up", target.x > center.x ? "right" : "left"];
  const all = allDirections.filter((dir) => dir !== oppositeDirection[enemy.dir]);
  const seed = seededValue(state.stage + Math.floor(state.time * 2), Math.round(enemy.x * 10), Math.round(enemy.y * 10));
  if (seed > 0.34) return preferred[0];
  if (seed > 0.14) return preferred[1];
  return all[Math.floor(seed * all.length) % all.length] ?? "down";
}

function updateEnemy(state: GameState, enemy: Tank, dt: number) {
  enemy.cooldown = Math.max(0, enemy.cooldown - dt);
  if (state.time < state.freezeUntil) return;
  enemy.aiTimer -= dt;
  if (enemy.aiTimer <= 0) {
    enemy.dir = chooseEnemyDirection(state, enemy);
    enemy.aiTimer = 0.55 + seededValue(state.stage, Math.round(enemy.x * 100), Math.round(enemy.y * 100)) * 1.4;
  }
  const vector = directionVectors[enemy.dir];
  const moved = tryMoveTank(state, enemy, vector.x * enemy.speed * dt, vector.y * enemy.speed * dt);
  enemy.stuckTimer = moved ? 0 : enemy.stuckTimer + dt;
  if (!moved && enemy.stuckTimer > 0.18) {
    enemy.dir = chooseEnemyDirection(state, enemy);
    enemy.aiTimer = 0.25;
  }
  const shootSeed = seededValue(Math.floor(state.time * 3) + state.stage, Math.round(enemy.x * 11), Math.round(enemy.y * 13));
  if (enemy.cooldown <= 0 && shootSeed > 0.68) shoot(state, enemy);
}

function spawnEnemy(state: GameState) {
  if (state.spawnedEnemies >= state.totalEnemies || state.enemies.length >= 4 || state.time < state.nextSpawnAt) return;
  const spawnPoints = [
    { x: 0.1, y: 0.1 },
    { x: 6.1, y: 0.1 },
    { x: 12 - TANK_SIZE, y: 0.1 },
  ];
  const point = spawnPoints[state.spawnedEnemies % spawnPoints.length];
  if (rectHitsTerrain(state.map, point.x, point.y, TANK_SIZE, state.baseAlive)) {
    state.nextSpawnAt = state.time + 0.8;
    return;
  }
  const level = Math.min(4, 1 + Math.floor((state.stage + state.spawnedEnemies) / 8));
  const enemy: Tank = {
    id: `enemy-${state.stage}-${state.spawnedEnemies}`,
    kind: "enemy",
    x: point.x,
    y: point.y,
    dir: "down",
    speed: 1.35 + level * 0.13,
    lives: level >= 4 ? 2 : 1,
    power: level,
    score: 0,
    cooldown: 1.1,
    invincible: 1,
    aiTimer: 0.4,
    stuckTimer: 0,
    color: level >= 4 ? "#eab308" : level >= 3 ? "#f97316" : "#94a3b8",
  };
  state.enemies.push(enemy);
  state.spawnedEnemies += 1;
  state.nextSpawnAt = state.time + Math.max(1.2, 2.8 - state.stage * 0.035);
}

function destroyTerrainAt(state: GameState, tx: number, ty: number, power: number) {
  const tile = tileAt(state.map, tx, ty);
  if (tile === 1) {
    state.map[ty][tx] = 0;
    return true;
  }
  if (tile === 2 && power >= 4) {
    state.map[ty][tx] = 0;
    return true;
  }
  return tile === 2 || tile === 3;
}

function updateBullets(state: GameState, dt: number) {
  const nextBullets: Bullet[] = [];
  for (const bullet of state.bullets) {
    const vector = directionVectors[bullet.dir];
    bullet.x += vector.x * bullet.speed * dt;
    bullet.y += vector.y * bullet.speed * dt;
    const cx = bullet.x + BULLET_SIZE / 2;
    const cy = bullet.y + BULLET_SIZE / 2;
    if (cx < 0 || cy < 0 || cx >= GRID_SIZE || cy >= GRID_SIZE) {
      addSpark(state, Math.max(0, Math.min(GRID_SIZE, cx)), Math.max(0, Math.min(GRID_SIZE, cy)), 0.18);
      continue;
    }
    if (state.baseAlive && rectsOverlap(bullet.x, bullet.y, bullet.x + BULLET_SIZE, bullet.y + BULLET_SIZE, 6.08, 12.08, 6.92, 12.92)) {
      state.baseAlive = false;
      state.status = "game-over";
      state.message = "基地被击毁";
      addSpark(state, 6.5, 12.5, 1.05, "#fb7185");
      continue;
    }
    const tx = Math.floor(cx);
    const ty = Math.floor(cy);
    const tile = tileAt(state.map, tx, ty);
    if (tile === 1 || tile === 2 || tile === 3) {
      destroyTerrainAt(state, tx, ty, bullet.power);
      addSpark(state, cx, cy, 0.22, tile === 2 ? "#cbd5e1" : "#f97316");
      continue;
    }
    if (bullet.ownerKind === "player") {
      const enemy = state.enemies.find((item) =>
        rectsOverlap(bullet.x, bullet.y, bullet.x + BULLET_SIZE, bullet.y + BULLET_SIZE, item.x, item.y, item.x + TANK_SIZE, item.y + TANK_SIZE),
      );
      if (enemy) {
        enemy.lives -= bullet.power >= 2 ? 2 : 1;
        const player = state.players.find((item) => item.player === bullet.player);
        addSpark(state, enemy.x + 0.4, enemy.y + 0.4, 0.45, "#fbbf24");
        if (enemy.lives <= 0) {
          state.enemies = state.enemies.filter((item) => item.id !== enemy.id);
          state.destroyedEnemies += 1;
          if (player) player.score += 500 + enemy.power * 100;
          if (player && seededValue(state.stage + state.destroyedEnemies, enemy.x, enemy.y) > 0.72) {
            spawnPowerup(state, enemy.x, enemy.y);
          }
        }
        continue;
      }
    } else {
      const player = state.players.find((item) =>
        item.active &&
        rectsOverlap(bullet.x, bullet.y, bullet.x + BULLET_SIZE, bullet.y + BULLET_SIZE, item.x, item.y, item.x + TANK_SIZE, item.y + TANK_SIZE),
      );
      if (player) {
        damagePlayer(state, player);
        continue;
      }
    }
    const otherBullet = nextBullets.find((item) =>
      rectsOverlap(bullet.x, bullet.y, bullet.x + BULLET_SIZE, bullet.y + BULLET_SIZE, item.x, item.y, item.x + BULLET_SIZE, item.y + BULLET_SIZE),
    );
    if (otherBullet) {
      nextBullets.splice(nextBullets.indexOf(otherBullet), 1);
      addSpark(state, cx, cy, 0.18);
      continue;
    }
    nextBullets.push(bullet);
  }
  state.bullets = nextBullets;
}

function updatePowerups(state: GameState) {
  state.powerups = state.powerups.filter((item) => item.expiresAt > state.time);
  for (const player of state.players) {
    if (!player.active) continue;
    const picked = state.powerups.find((item) =>
      rectsOverlap(player.x, player.y, player.x + TANK_SIZE, player.y + TANK_SIZE, item.x, item.y, item.x + 0.78, item.y + 0.78),
    );
    if (!picked) continue;
    applyPowerup(state, player, picked.type);
    state.powerups = state.powerups.filter((item) => item.id !== picked.id);
  }
}

function protectBaseWithSteel(state: GameState) {
  const active = state.time < state.shovelUntil;
  [
    [5, 11],
    [6, 11],
    [7, 11],
    [5, 12],
    [7, 12],
  ].forEach(([x, y]) => {
    if (active) {
      state.map[y][x] = 2;
    } else if (state.map[y][x] === 2) {
      state.map[y][x] = 1;
    }
  });
}

function updateStageStatus(state: GameState) {
  if (state.status !== "playing") return;
  if (!state.baseAlive) {
    state.status = "game-over";
    state.message = "基地被击毁";
    return;
  }
  if (state.destroyedEnemies >= state.totalEnemies && state.enemies.length === 0) {
    state.status = "stage-clear";
    state.stageClearAt = state.time + 2.2;
    state.players.forEach((player) => {
      if (player.active) player.score += 1000;
    });
    state.message = "关卡完成";
  }
}

function maybeAdvanceStage(state: GameState) {
  if (state.status !== "stage-clear" || state.time < state.stageClearAt) return state;
  const nextStage = state.stage >= MAX_STAGE ? 1 : state.stage + 1;
  const next = createGameState(state.mode, nextStage, state.players, state.highScore);
  next.status = "playing";
  next.message = `第 ${nextStage} 关`;
  return next;
}

function updateGameState(state: GameState, dt: number, inputP1: InputState, inputP2: InputState) {
  if (state.status !== "playing") return maybeAdvanceStage(state);
  state.time += dt;
  protectBaseWithSteel(state);
  spawnEnemy(state);
  updatePlayer(state, state.players[0], inputP1, dt);
  updatePlayer(state, state.players[1], inputP2, dt);
  state.enemies.forEach((enemy) => updateEnemy(state, enemy, dt));
  updateBullets(state, dt);
  updatePowerups(state);
  state.sparks = state.sparks.filter((spark) => spark.expiresAt > state.time);
  updateStageStatus(state);
  const totalScore = state.players.reduce((sum, player) => sum + player.score, 0);
  if (totalScore > state.highScore) {
    state.highScore = totalScore;
    writeHighScore(totalScore);
  }
  return maybeAdvanceStage(state);
}

function serializeState(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state)) as GameState;
}

function buildUiState(state: GameState, roomId: string, onlineRole: OnlineRole, peers: number, networkStatus: string): UiState {
  return {
    status: state.status,
    mode: state.mode,
    stage: state.stage,
    totalScore: state.players.reduce((sum, player) => sum + player.score, 0),
    highScore: state.highScore,
    p1Lives: state.players[0]?.lives ?? 0,
    p2Lives: state.players[1]?.active ? state.players[1].lives : 0,
    p1Power: state.players[0]?.power ?? 1,
    p2Power: state.players[1]?.active ? state.players[1].power : 1,
    enemiesLeft: Math.max(0, state.totalEnemies - state.destroyedEnemies),
    message: state.message,
    roomId,
    onlineRole,
    peers,
    networkStatus,
  };
}

function drawRoundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
  ctx.fill();
}

function drawTerrain(ctx: CanvasRenderingContext2D, map: Terrain[][], state: GameState, forestLayer: boolean) {
  for (let y = 0; y < GRID_SIZE; y += 1) {
    for (let x = 0; x < GRID_SIZE; x += 1) {
      const tile = map[y][x];
      if ((tile === 4) !== forestLayer) continue;
      const px = x * TILE_SIZE;
      const py = y * TILE_SIZE;
      if (tile === 1) {
        ctx.fillStyle = "#b45309";
        ctx.fillRect(px + 1, py + 1, TILE_SIZE - 2, TILE_SIZE - 2);
        ctx.fillStyle = "#f59e0b";
        for (let row = 0; row < 4; row += 1) {
          for (let col = 0; col < 2; col += 1) {
            ctx.fillRect(px + col * 16 + (row % 2) * 8 + 1, py + row * 8 + 1, 14, 6);
          }
        }
      } else if (tile === 2) {
        ctx.fillStyle = "#64748b";
        ctx.fillRect(px + 1, py + 1, TILE_SIZE - 2, TILE_SIZE - 2);
        ctx.strokeStyle = "#cbd5e1";
        ctx.lineWidth = 2;
        ctx.strokeRect(px + 5, py + 5, TILE_SIZE - 10, TILE_SIZE - 10);
      } else if (tile === 3) {
        ctx.fillStyle = "#075985";
        ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
        ctx.strokeStyle = "#38bdf8";
        ctx.lineWidth = 2;
        for (let wave = 0; wave < 3; wave += 1) {
          ctx.beginPath();
          ctx.arc(px + 8 + wave * 9, py + 16, 7, 0, Math.PI);
          ctx.stroke();
        }
      } else if (tile === 4) {
        ctx.fillStyle = "rgba(22, 101, 52, 0.74)";
        ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
        ctx.fillStyle = "rgba(34, 197, 94, 0.7)";
        ctx.beginPath();
        ctx.arc(px + 10, py + 11, 8, 0, Math.PI * 2);
        ctx.arc(px + 22, py + 20, 9, 0, Math.PI * 2);
        ctx.arc(px + 20, py + 8, 7, 0, Math.PI * 2);
        ctx.fill();
      } else if (tile === 5) {
        ctx.fillStyle = "#cffafe";
        ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
        ctx.strokeStyle = "rgba(14, 165, 233, 0.55)";
        ctx.beginPath();
        ctx.moveTo(px + 5, py + 24);
        ctx.lineTo(px + 24, py + 5);
        ctx.stroke();
      }
    }
  }

  if (!forestLayer && state.baseAlive) {
    const px = 6 * TILE_SIZE;
    const py = 12 * TILE_SIZE;
    ctx.fillStyle = "#fde68a";
    drawRoundRect(ctx, px + 5, py + 5, TILE_SIZE - 10, TILE_SIZE - 10, 5);
    ctx.fillStyle = "#0f172a";
    ctx.font = "bold 18px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("F", px + TILE_SIZE / 2, py + TILE_SIZE / 2 + 1);
  } else if (!forestLayer) {
    const px = 6 * TILE_SIZE;
    const py = 12 * TILE_SIZE;
    ctx.fillStyle = "#7f1d1d";
    ctx.fillRect(px + 4, py + 4, TILE_SIZE - 8, TILE_SIZE - 8);
    ctx.fillStyle = "#fecaca";
    ctx.font = "bold 18px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("×", px + TILE_SIZE / 2, py + TILE_SIZE / 2);
  }
}

function drawTank(ctx: CanvasRenderingContext2D, tank: Tank, time: number) {
  if (tank.kind === "player" && !tank.active) return;
  const px = tank.x * TILE_SIZE;
  const py = tank.y * TILE_SIZE;
  const size = TANK_SIZE * TILE_SIZE;
  const centerX = px + size / 2;
  const centerY = py + size / 2;
  ctx.save();
  ctx.translate(centerX, centerY);
  const rotation = tank.dir === "up" ? 0 : tank.dir === "right" ? Math.PI / 2 : tank.dir === "down" ? Math.PI : -Math.PI / 2;
  ctx.rotate(rotation);
  ctx.fillStyle = tank.invincible > 0 && Math.floor(time * 8) % 2 === 0 ? "#f8fafc" : tank.color;
  drawRoundRect(ctx, -size * 0.42, -size * 0.36, size * 0.84, size * 0.72, 5);
  ctx.fillStyle = "rgba(15, 23, 42, 0.62)";
  ctx.fillRect(-size * 0.48, -size * 0.42, size * 0.18, size * 0.84);
  ctx.fillRect(size * 0.3, -size * 0.42, size * 0.18, size * 0.84);
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(-size * 0.08, -size * 0.58, size * 0.16, size * 0.44);
  ctx.fillStyle = tank.kind === "player" ? "#020617" : "#fff7ed";
  ctx.font = "bold 12px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(tank.kind === "player" ? String(tank.player) : tank.power > 2 ? "★" : "", 0, size * 0.05);
  ctx.restore();
}

function drawPowerup(ctx: CanvasRenderingContext2D, powerup: Powerup) {
  const px = powerup.x * TILE_SIZE;
  const py = powerup.y * TILE_SIZE;
  ctx.fillStyle = "#fef3c7";
  drawRoundRect(ctx, px, py, 25, 25, 6);
  ctx.strokeStyle = "#f59e0b";
  ctx.lineWidth = 2;
  ctx.strokeRect(px + 3, py + 3, 19, 19);
  ctx.fillStyle = "#92400e";
  ctx.font = "bold 14px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(powerupLabels[powerup.type], px + 12.5, py + 13);
}

function drawGame(ctx: CanvasRenderingContext2D, state: GameState) {
  ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  ctx.fillStyle = "#111827";
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  ctx.strokeStyle = "rgba(148, 163, 184, 0.1)";
  ctx.lineWidth = 1;
  for (let index = 0; index <= GRID_SIZE; index += 1) {
    ctx.beginPath();
    ctx.moveTo(index * TILE_SIZE, 0);
    ctx.lineTo(index * TILE_SIZE, CANVAS_SIZE);
    ctx.moveTo(0, index * TILE_SIZE);
    ctx.lineTo(CANVAS_SIZE, index * TILE_SIZE);
    ctx.stroke();
  }
  drawTerrain(ctx, state.map, state, false);
  state.powerups.forEach((powerup) => drawPowerup(ctx, powerup));
  state.players.forEach((player) => drawTank(ctx, player, state.time));
  state.enemies.forEach((enemy) => drawTank(ctx, enemy, state.time));
  ctx.fillStyle = "#fef2f2";
  state.bullets.forEach((bullet) => {
    ctx.fillRect(bullet.x * TILE_SIZE, bullet.y * TILE_SIZE, Math.max(4, BULLET_SIZE * TILE_SIZE), Math.max(4, BULLET_SIZE * TILE_SIZE));
  });
  state.sparks.forEach((spark) => {
    const progress = Math.max(0, Math.min(1, (spark.expiresAt - state.time) / 0.28));
    ctx.fillStyle = spark.color;
    ctx.globalAlpha = progress;
    ctx.beginPath();
    ctx.arc(spark.x * TILE_SIZE, spark.y * TILE_SIZE, spark.radius * TILE_SIZE * (1 - progress * 0.28), 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  });
  drawTerrain(ctx, state.map, state, true);
  if (state.status !== "playing") {
    ctx.fillStyle = "rgba(2, 6, 23, 0.62)";
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    ctx.fillStyle = "#f8fafc";
    ctx.font = "900 32px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const label =
      state.status === "ready"
        ? "准备开始"
        : state.status === "paused"
          ? "暂停"
          : state.status === "stage-clear"
            ? "关卡完成"
            : "游戏结束";
    ctx.fillText(label, CANVAS_SIZE / 2, CANVAS_SIZE / 2 - 10);
    ctx.font = "600 15px Arial";
    ctx.fillText(state.message, CANVAS_SIZE / 2, CANVAS_SIZE / 2 + 28);
  }
}

export default function TankBattleClient({ subtitle = "小工具 / 小游戏" }: TankBattleClientProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef<GameState>(createGameState("solo"));
  const keyboardP1Ref = useRef<InputState>(cloneInput(emptyInput));
  const keyboardP2Ref = useRef<InputState>(cloneInput(emptyInput));
  const touchInputRef = useRef<InputState>(cloneInput(emptyInput));
  const remoteInputRef = useRef<InputState>(cloneInput(emptyInput));
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const lastBroadcastRef = useRef(0);
  const joystickPointerIdRef = useRef<number | null>(null);
  const firePointerIdRef = useRef<number | null>(null);
  const [touchPlayer, setTouchPlayer] = useState<1 | 2>(1);
  const [joystickThumb, setJoystickThumb] = useState({ x: 0, y: 0, active: false });
  const [roomInput, setRoomInput] = useState("");
  const [roomId, setRoomId] = useState("");
  const [onlineRole, setOnlineRole] = useState<OnlineRole>("none");
  const [networkStatus, setNetworkStatus] = useState("未联网");
  const [peers, setPeers] = useState(0);
  const [copied, setCopied] = useState(false);
  const [ui, setUi] = useState<UiState>(() => buildUiState(createGameState("solo"), "", "none", 0, "未联网"));

  const canUseOnline = hasSupabaseEnv;
  const isGuest = onlineRole === "guest";
  const localTouchPlayer = isGuest ? 2 : touchPlayer;

  const resetState = useCallback((mode: GameMode, stage = 1) => {
    stateRef.current = createGameState(mode, stage, undefined, readHighScore());
    stateRef.current.status = mode === "online-guest" ? "ready" : "playing";
    stateRef.current.message = mode === "online-guest" ? "等待房主同步" : `第 ${stage} 关`;
    setUi(buildUiState(stateRef.current, roomId, onlineRole, peers, networkStatus));
  }, [networkStatus, onlineRole, peers, roomId]);

  const startSolo = useCallback(() => {
    setOnlineRole("none");
    setRoomId("");
    setNetworkStatus("未联网");
    setPeers(0);
    resetState("solo");
    setTouchPlayer(1);
  }, [resetState]);

  const startLocal = useCallback(() => {
    setOnlineRole("none");
    setRoomId("");
    setNetworkStatus("本地双人");
    setPeers(0);
    resetState("local");
  }, [resetState]);

  const startHost = useCallback(() => {
    const nextRoom = createRoomId();
    setRoomId(nextRoom);
    setRoomInput(nextRoom);
    setOnlineRole("host");
    setNetworkStatus(canUseOnline ? "创建房间中" : "当前环境未配置联网服务");
    stateRef.current = createGameState("online-host", 1, undefined, readHighScore());
    stateRef.current.status = "playing";
    stateRef.current.message = `房间 ${nextRoom}`;
    setTouchPlayer(1);
    setUi(buildUiState(stateRef.current, nextRoom, "host", peers, canUseOnline ? "创建房间中" : "当前环境未配置联网服务"));
  }, [canUseOnline, peers]);

  const joinRoom = useCallback((targetRoom?: string) => {
    const nextRoom = normalizeRoomId(targetRoom ?? roomInput);
    if (!nextRoom) {
      setNetworkStatus("请输入房间号");
      return;
    }
    setRoomId(nextRoom);
    setRoomInput(nextRoom);
    setOnlineRole("guest");
    setNetworkStatus(canUseOnline ? "加入房间中" : "当前环境未配置联网服务");
    stateRef.current = createGameState("online-guest", 1, undefined, readHighScore());
    stateRef.current.message = `等待房主 ${nextRoom}`;
    setTouchPlayer(2);
    setUi(buildUiState(stateRef.current, nextRoom, "guest", peers, canUseOnline ? "加入房间中" : "当前环境未配置联网服务"));
  }, [canUseOnline, peers, roomInput]);

  const pauseOrResume = useCallback(() => {
    if (isGuest) return;
    const state = stateRef.current;
    if (state.status === "playing") {
      state.status = "paused";
      state.message = "暂停";
    } else if (state.status === "paused") {
      state.status = "playing";
      state.message = `第 ${state.stage} 关`;
    }
    setUi(buildUiState(state, roomId, onlineRole, peers, networkStatus));
  }, [isGuest, networkStatus, onlineRole, peers, roomId]);

  const restartCurrent = useCallback(() => {
    if (isGuest) return;
    const mode = stateRef.current.mode === "online-guest" ? "solo" : stateRef.current.mode;
    resetState(mode, stateRef.current.stage);
  }, [isGuest, resetState]);

  const nextStage = useCallback(() => {
    if (isGuest) return;
    const state = stateRef.current;
    const mode = state.mode === "online-guest" ? "solo" : state.mode;
    resetState(mode, state.stage >= MAX_STAGE ? 1 : state.stage + 1);
  }, [isGuest, resetState]);

  const copyRoomLink = useCallback(async () => {
    if (!roomId || typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("room", roomId);
    url.searchParams.set("role", "guest");
    try {
      await navigator.clipboard.writeText(url.toString());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }, [roomId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const queryRoom = normalizeRoomId(params.get("room") ?? "");
    if (queryRoom) {
      window.setTimeout(() => {
        setRoomInput(queryRoom);
        if (params.get("role") === "guest") {
          joinRoom(queryRoom);
        }
      }, 80);
    }
  }, [joinRoom]);

  useEffect(() => {
    const applyKey = (event: KeyboardEvent, pressed: boolean) => {
      const key = event.key.toLowerCase();
      const p1 = keyboardP1Ref.current;
      const p2 = keyboardP2Ref.current;
      let handled = true;
      if (key === "w") p1.up = pressed;
      else if (key === "s") p1.down = pressed;
      else if (key === "a") p1.left = pressed;
      else if (key === "d") p1.right = pressed;
      else if (key === " " || key === "spacebar") p1.fire = pressed;
      else if (event.key === "ArrowUp") p2.up = pressed;
      else if (event.key === "ArrowDown") p2.down = pressed;
      else if (event.key === "ArrowLeft") p2.left = pressed;
      else if (event.key === "ArrowRight") p2.right = pressed;
      else if (key === "enter") p2.fire = pressed;
      else handled = false;
      if (handled) event.preventDefault();
    };
    const onKeyDown = (event: KeyboardEvent) => applyKey(event, true);
    const onKeyUp = (event: KeyboardEvent) => applyKey(event, false);
    window.addEventListener("keydown", onKeyDown, { passive: false });
    window.addEventListener("keyup", onKeyUp, { passive: false });
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  useEffect(() => {
    if (!roomId || onlineRole === "none") return;
    if (!canUseOnline) return;
    const channel = supabase.channel(`faolla-tank-battle-${roomId}`, {
      config: {
        broadcast: { self: false },
        presence: { key: `${onlineRole}-${Math.random().toString(16).slice(2)}` },
      },
    });
    channel
      .on("broadcast", { event: "input" }, ({ payload }) => {
        if (onlineRole !== "host") return;
        const record = payload as { input?: InputState; player?: number };
        if (record.player === 2 && record.input) {
          remoteInputRef.current = cloneInput(record.input);
        }
      })
      .on("broadcast", { event: "snapshot" }, ({ payload }) => {
        if (onlineRole !== "guest") return;
        const record = payload as { state?: GameState };
        if (record.state) {
          stateRef.current = record.state;
        }
      })
      .on("presence", { event: "sync" }, () => {
        const presenceState = channel.presenceState();
        setPeers(Object.values(presenceState).reduce((sum, entries) => sum + entries.length, 0));
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({ role: onlineRole, roomId, at: Date.now() });
          setNetworkStatus(onlineRole === "host" ? "房间已创建" : "已加入房间");
        } else if (status === "CHANNEL_ERROR") {
          setNetworkStatus("联网通道异常");
        } else if (status === "TIMED_OUT") {
          setNetworkStatus("联网超时");
        } else if (status === "CLOSED") {
          setNetworkStatus("联网已断开");
        }
      });
    channelRef.current = channel;
    return () => {
      void supabase.removeChannel(channel);
      if (channelRef.current === channel) channelRef.current = null;
      setPeers(0);
    };
  }, [canUseOnline, onlineRole, roomId]);

  useEffect(() => {
    if (onlineRole !== "guest") return;
    const timer = window.setInterval(() => {
      const channel = channelRef.current;
      if (!channel) return;
      const localInput = mergeInput(keyboardP2Ref.current, touchInputRef.current);
      void channel.send({
        type: "broadcast",
        event: "input",
        payload: {
          player: 2,
          input: localInput,
          at: Date.now(),
        },
      });
    }, 48);
    return () => window.clearInterval(timer);
  }, [onlineRole]);

  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    let lastUi = 0;
    const tick = (now: number) => {
      const dt = Math.min(0.045, Math.max(0.001, (now - last) / 1000));
      last = now;
      const state = stateRef.current;
      if (onlineRole !== "guest") {
        const p1Touch = localTouchPlayer === 1 ? touchInputRef.current : emptyInput;
        const p2Touch = localTouchPlayer === 2 ? touchInputRef.current : emptyInput;
        const p1Input = mergeInput(keyboardP1Ref.current, p1Touch);
        const p2Input =
          onlineRole === "host"
            ? remoteInputRef.current
            : mergeInput(keyboardP2Ref.current, p2Touch);
        stateRef.current = updateGameState(state, dt, p1Input, p2Input);
        if (onlineRole === "host" && channelRef.current && now - lastBroadcastRef.current > 80) {
          lastBroadcastRef.current = now;
          void channelRef.current.send({
            type: "broadcast",
            event: "snapshot",
            payload: {
              state: serializeState(stateRef.current),
              at: Date.now(),
            },
          });
        }
      } else {
        stateRef.current.time += dt;
      }
      const ctx = canvasRef.current?.getContext("2d");
      if (ctx) drawGame(ctx, stateRef.current);
      if (now - lastUi > 120) {
        lastUi = now;
        setUi(buildUiState(stateRef.current, roomId, onlineRole, peers, networkStatus));
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [localTouchPlayer, networkStatus, onlineRole, peers, roomId]);

  const modeLabel = useMemo(() => {
    if (ui.mode === "solo") return "单人";
    if (ui.mode === "local") return "本地双人";
    if (ui.mode === "online-host") return "联网房主";
    return "联网加入";
  }, [ui.mode]);

  const setTouch = (patch: Partial<InputState>) => {
    touchInputRef.current = { ...touchInputRef.current, ...patch };
  };

  const applyJoystickVector = (rawX: number, rawY: number) => {
    const maxRadius = 42;
    const deadZone = 10;
    const distance = Math.hypot(rawX, rawY);
    const scale = distance > maxRadius ? maxRadius / distance : 1;
    const x = rawX * scale;
    const y = rawY * scale;
    setJoystickThumb({ x, y, active: distance > deadZone });

    if (distance < deadZone) {
      setTouch({ up: false, down: false, left: false, right: false });
      return;
    }

    if (Math.abs(rawX) > Math.abs(rawY)) {
      setTouch({ up: false, down: false, left: rawX < 0, right: rawX > 0 });
      return;
    }

    setTouch({ up: rawY < 0, down: rawY > 0, left: false, right: false });
  };

  const updateJoystickFromPointer = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    applyJoystickVector(event.clientX - rect.left - rect.width / 2, event.clientY - rect.top - rect.height / 2);
  };

  const handleJoystickDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    joystickPointerIdRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    updateJoystickFromPointer(event);
  };

  const handleJoystickMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (joystickPointerIdRef.current !== event.pointerId) return;
    updateJoystickFromPointer(event);
  };

  const clearJoystick = (event?: ReactPointerEvent<HTMLButtonElement>) => {
    if (event) {
      event.preventDefault();
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    }
    joystickPointerIdRef.current = null;
    setJoystickThumb({ x: 0, y: 0, active: false });
    setTouch({ up: false, down: false, left: false, right: false });
  };

  const handleFireDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    firePointerIdRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    setTouch({ fire: true });
  };

  const clearFire = (event?: ReactPointerEvent<HTMLButtonElement>) => {
    if (event) {
      event.preventDefault();
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    }
    firePointerIdRef.current = null;
    setTouch({ fire: false });
  };

  return (
    <main className="tank-battle-page min-h-screen bg-[#eef2f3] px-3 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] pt-[calc(env(safe-area-inset-top)+0.9rem)] text-slate-950">
      <style jsx global>{`
        @media (orientation: landscape) and (max-height: 640px) {
          .tank-battle-page {
            height: 100dvh;
            overflow: hidden;
            padding: 0;
            background: #020617;
          }

          .tank-battle-shell {
            height: 100dvh;
            max-width: none;
            gap: 0;
          }

          .tank-battle-header,
          .tank-battle-stats,
          .tank-battle-mode-controls,
          .tank-battle-sidebar,
          .tank-battle-footer {
            display: none !important;
          }

          .tank-battle-layout {
            display: block;
            height: 100dvh;
          }

          .tank-battle-stage-card {
            position: relative;
            height: 100dvh;
            overflow: hidden;
            border: 0;
            border-radius: 0;
            background: #020617;
            padding: 0;
            box-shadow: none;
          }

          .tank-battle-canvas-wrap {
            height: 100dvh;
            max-width: none;
            width: 100dvh;
            padding: max(4px, env(safe-area-inset-top));
            border-radius: 0;
            box-shadow: none;
          }

          .tank-battle-canvas-wrap canvas {
            border-radius: 0;
          }

          .tank-battle-mobile-controls {
            position: absolute;
            inset: 0;
            display: flex !important;
            align-items: flex-end;
            margin: 0;
            border: 0;
            border-radius: 0;
            background: linear-gradient(90deg, rgba(2, 6, 23, 0.42), transparent 30%, transparent 70%, rgba(2, 6, 23, 0.42));
            padding: 0 max(18px, env(safe-area-inset-right)) max(16px, env(safe-area-inset-bottom)) max(18px, env(safe-area-inset-left));
            pointer-events: none;
            box-shadow: none;
          }

          .tank-battle-mobile-controls > div {
            width: 100%;
            pointer-events: none;
          }

          .tank-battle-mobile-controls button {
            pointer-events: auto;
          }
        }
      `}</style>
      <div className="tank-battle-shell mx-auto flex max-w-6xl flex-col gap-3">
        <header className="tank-battle-header flex items-center justify-between gap-3 rounded-[24px] border border-slate-200 bg-white px-4 py-3 shadow-[0_14px_34px_rgba(15,23,42,0.08)]">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-13 w-13 shrink-0 items-center justify-center rounded-[18px] bg-lime-700 text-white shadow-[0_12px_24px_rgba(77,124,15,0.28)]">
              <TankBattleIcon />
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-xl font-black text-slate-950">坦克大战</h1>
              <div className="truncate text-xs text-slate-500">{subtitle}</div>
            </div>
          </div>
          <div className="rounded-2xl bg-slate-100 px-3 py-2 text-right">
            <div className="text-[11px] font-semibold text-slate-500">最高分</div>
            <div className="text-base font-black tabular-nums text-slate-950">{ui.highScore}</div>
          </div>
        </header>

        <section className="tank-battle-layout grid gap-3 lg:grid-cols-[minmax(0,1fr)_330px]">
          <div className="tank-battle-stage-card rounded-[24px] border border-slate-200 bg-white p-3 shadow-[0_14px_34px_rgba(15,23,42,0.08)]">
            <div className="tank-battle-stats grid grid-cols-4 gap-2 pb-3">
              {[
                ["关卡", ui.stage],
                ["模式", modeLabel],
                ["敌军", ui.enemiesLeft],
                ["总分", ui.totalScore],
              ].map(([label, value]) => (
                <div key={label} className="rounded-2xl bg-slate-50 px-3 py-2">
                  <div className="text-[11px] font-semibold text-slate-500">{label}</div>
                  <div className="truncate text-sm font-black tabular-nums text-slate-950">{value}</div>
                </div>
              ))}
            </div>

            <div className="tank-battle-canvas-wrap mx-auto aspect-square w-full max-w-[min(92vw,620px)] overflow-hidden rounded-[18px] bg-slate-950 p-1 shadow-inner">
              <canvas
                ref={canvasRef}
                width={CANVAS_SIZE}
                height={CANVAS_SIZE}
                className="h-full w-full rounded-[14px] bg-slate-900 [image-rendering:pixelated]"
              />
            </div>

            <section className="tank-battle-mobile-controls mt-2 rounded-[22px] border border-slate-200 bg-slate-950 px-4 py-3 shadow-inner lg:hidden">
              <div className="flex items-center justify-between gap-4">
                <button
                  type="button"
                  aria-label="移动轮盘"
                  className="relative h-[118px] w-[118px] shrink-0 touch-none select-none rounded-full border border-white/15 bg-slate-900/95 shadow-[0_16px_36px_rgba(2,6,23,0.32)] active:scale-[0.99]"
                  onPointerDown={handleJoystickDown}
                  onPointerMove={handleJoystickMove}
                  onPointerUp={clearJoystick}
                  onPointerCancel={clearJoystick}
                  onLostPointerCapture={() => clearJoystick()}
                  onContextMenu={(event) => event.preventDefault()}
                >
                  <span className="absolute left-1/2 top-3 h-2 w-2 -translate-x-1/2 rounded-full bg-white/35" />
                  <span className="absolute bottom-3 left-1/2 h-2 w-2 -translate-x-1/2 rounded-full bg-white/25" />
                  <span className="absolute left-3 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-white/25" />
                  <span className="absolute right-3 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-white/25" />
                  <span className="absolute left-1/2 top-1/2 h-[74px] w-[74px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/10 bg-white/5" />
                  <span
                    className={`absolute left-1/2 top-1/2 h-[50px] w-[50px] rounded-full border border-white/20 bg-slate-100 shadow-[0_10px_24px_rgba(0,0,0,0.28)] transition ${joystickThumb.active ? "opacity-100" : "opacity-90"}`}
                    style={{ transform: `translate(calc(-50% + ${joystickThumb.x}px), calc(-50% + ${joystickThumb.y}px))` }}
                  />
                </button>

                <button
                  type="button"
                  aria-label="开火"
                  className="flex h-[76px] w-[76px] shrink-0 touch-none select-none items-center justify-center rounded-full border-[5px] border-rose-300/40 bg-rose-600 text-xl font-black text-white shadow-[0_16px_34px_rgba(190,18,60,0.34)] active:scale-95"
                  onPointerDown={handleFireDown}
                  onPointerUp={clearFire}
                  onPointerCancel={clearFire}
                  onLostPointerCapture={() => clearFire()}
                  onContextMenu={(event) => event.preventDefault()}
                >
                  火
                </button>
              </div>
            </section>

            <div className="tank-battle-mode-controls mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <button type="button" className="rounded-2xl bg-slate-950 px-3 py-3 text-sm font-bold text-white" onClick={startSolo}>
                单人开始
              </button>
              <button type="button" className="rounded-2xl bg-slate-900 px-3 py-3 text-sm font-bold text-white" onClick={startLocal}>
                本地双打
              </button>
              <button type="button" className="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-bold text-slate-800" onClick={pauseOrResume} disabled={isGuest}>
                {ui.status === "paused" ? "继续" : "暂停"}
              </button>
              <button type="button" className="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-bold text-slate-800" onClick={restartCurrent} disabled={isGuest}>
                重开本关
              </button>
            </div>
          </div>

          <aside className="tank-battle-sidebar space-y-3">
            <section className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-[0_14px_34px_rgba(15,23,42,0.08)]">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-black text-slate-950">状态</div>
                  <div className="mt-1 text-xs text-slate-500">{ui.message}</div>
                </div>
                <button type="button" className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700" onClick={nextStage} disabled={isGuest}>
                  下一关
                </button>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="rounded-2xl bg-emerald-50 px-3 py-2">
                  <div className="text-xs font-semibold text-emerald-700">玩家一</div>
                  <div className="mt-1 text-sm font-black text-slate-950">命 {ui.p1Lives} / 火力 {ui.p1Power}</div>
                </div>
                <div className="rounded-2xl bg-amber-50 px-3 py-2">
                  <div className="text-xs font-semibold text-amber-700">玩家二</div>
                  <div className="mt-1 text-sm font-black text-slate-950">命 {ui.p2Lives} / 火力 {ui.p2Power}</div>
                </div>
              </div>
            </section>

            <section className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-[0_14px_34px_rgba(15,23,42,0.08)]">
              <div className="text-sm font-black text-slate-950">联网双打</div>
              <div className="mt-1 text-xs leading-5 text-slate-500">
                房主控制玩家一，加入者控制玩家二。联网依赖 Supabase Realtime。
              </div>
              <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
                <input
                  value={roomInput}
                  onChange={(event) => setRoomInput(normalizeRoomId(event.target.value))}
                  placeholder="房间号"
                  className="min-w-0 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-bold uppercase text-slate-950 outline-none focus:border-slate-400"
                />
                <button type="button" className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-bold text-white" onClick={() => joinRoom()}>
                  加入
                </button>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button type="button" className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm font-bold text-emerald-800" onClick={startHost}>
                  创建房间
                </button>
                <button type="button" className="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-bold text-slate-700 disabled:opacity-50" onClick={copyRoomLink} disabled={!roomId}>
                  {copied ? "已复制" : "复制邀请"}
                </button>
              </div>
              <div className="mt-3 rounded-2xl bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-500">
                <span className="font-semibold text-slate-800">房间：</span>{roomId || "未创建"} · <span className="font-semibold text-slate-800">连接：</span>{networkStatus} · {peers} 人在线
              </div>
            </section>

            <section className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-[0_14px_34px_rgba(15,23,42,0.08)]">
              <div className="text-sm font-black text-slate-950">操作</div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs leading-5 text-slate-500">
                <div className="rounded-2xl bg-slate-50 p-3">
                  <div className="font-bold text-slate-800">玩家一</div>
                  WASD 移动，空格开火
                </div>
                <div className="rounded-2xl bg-slate-50 p-3">
                  <div className="font-bold text-slate-800">玩家二</div>
                  方向键移动，回车开火
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  className={`rounded-2xl px-3 py-2 text-xs font-bold ${localTouchPlayer === 1 ? "bg-emerald-700 text-white" : "bg-slate-100 text-slate-700"}`}
                  onClick={() => setTouchPlayer(1)}
                  disabled={isGuest}
                >
                  触控玩家一
                </button>
                <button
                  type="button"
                  className={`rounded-2xl px-3 py-2 text-xs font-bold ${localTouchPlayer === 2 ? "bg-amber-600 text-white" : "bg-slate-100 text-slate-700"}`}
                  onClick={() => setTouchPlayer(2)}
                  disabled={ui.mode === "solo" || onlineRole === "host"}
                >
                  触控玩家二
                </button>
              </div>
            </section>
          </aside>
        </section>

        <section className="tank-battle-footer rounded-[24px] border border-slate-200 bg-white p-4 text-xs leading-6 text-slate-500 shadow-[0_14px_34px_rgba(15,23,42,0.08)]">
          已实现基地防守、砖墙/钢墙/水域/树林/冰面、敌军出生、敌军 AI、子弹碰撞、玩家生命、火力升级、护盾、清屏、暂停敌军、基地钢墙、加命、关卡循环、单人、本地双人和联网双打。
        </section>
      </div>
    </main>
  );
}
