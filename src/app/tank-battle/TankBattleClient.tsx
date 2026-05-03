"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import TankBattleIcon from "@/components/TankBattleIcon";
import { writeTankBattleLobbyReturnTarget } from "@/lib/tankBattleLobbyReturn";

type Direction = "up" | "down" | "left" | "right";
type GameMode = "solo" | "online-host" | "online-guest";
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
  bonus?: boolean;
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

type PowerupPickup = {
  id: string;
  type: PowerupType;
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
  lastPowerupPickup: PowerupPickup | null;
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
  lobbyHref?: string;
};

type TankBattleSoundName =
  | "menu"
  | "start"
  | "pause"
  | "resume"
  | "shoot"
  | "enemyShoot"
  | "hit"
  | "destroy"
  | "bomb"
  | "powerupSpawn"
  | "powerup"
  | "playerDown"
  | "baseDown"
  | "stageClear"
  | "gameOver";

type TankBattleSoundSnapshot = {
  status: GameStatus;
  stage: number;
  baseAlive: boolean;
  destroyedEnemies: number;
  bulletIds: Set<string>;
  powerupIds: Set<string>;
  sparkIds: Set<string>;
  p1Lives: number;
  p2Lives: number;
  p1Power: number;
  p2Power: number;
  p1Active: boolean;
  p2Active: boolean;
  totalScore: number;
  message: string;
  lastPowerupPickupId: string;
  lastPowerupPickupType: PowerupType | null;
};

type TankBattleMobileFrame = {
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
  viewportLeft: number;
  viewportTop: number;
  rotateShell: boolean;
};

type AudioWindow = Window &
  typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
  };

type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void>;
};

type LockableScreenOrientation = ScreenOrientation & {
  lock?: (orientation: string) => Promise<void>;
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
  star: "★",
  bomb: "爆",
  clock: "停",
  shovel: "铲",
  tank: "1UP",
};
const powerupStyles: Record<PowerupType, { background: string; border: string; foreground: string }> = {
  helmet: { background: "#38bdf8", border: "#e0f2fe", foreground: "#082f49" },
  star: { background: "#fde047", border: "#fff7ed", foreground: "#713f12" },
  bomb: { background: "#fb7185", border: "#ffe4e6", foreground: "#4c0519" },
  clock: { background: "#a78bfa", border: "#ede9fe", foreground: "#2e1065" },
  shovel: { background: "#f97316", border: "#ffedd5", foreground: "#431407" },
  tank: { background: "#22c55e", border: "#dcfce7", foreground: "#052e16" },
};

let tankBattleAudioContext: AudioContext | null = null;
let tankBattleMasterGain: GainNode | null = null;
let tankBattleEngineOscillator: OscillatorNode | null = null;
let tankBattleEngineGain: GainNode | null = null;
let tankBattleEngineActive = false;
let tankBattleMusicTimer: number | null = null;
let tankBattleMusicStep = 0;
let tankBattleMusicActive = false;

const tankBattleMusicPattern: Array<{ note?: number; harmony?: number; bass?: number; accent?: boolean }> = [
  { note: 220, bass: 110, accent: true },
  { note: 277 },
  { note: 330 },
  { note: 277 },
  { note: 392, bass: 147, accent: true },
  { note: 330 },
  { note: 277, harmony: 415 },
  {},
  { note: 247, bass: 123, accent: true },
  { note: 311 },
  { note: 370 },
  { note: 311 },
  { note: 440, bass: 165, accent: true },
  { note: 370 },
  { note: 311, harmony: 466 },
  {},
  { note: 262, bass: 131, accent: true },
  { note: 330 },
  { note: 392 },
  { note: 330 },
  { note: 494, bass: 196, accent: true },
  { note: 392 },
  { note: 330, harmony: 523 },
  {},
  { note: 294, bass: 147, accent: true },
  { note: 370 },
  { note: 440 },
  { note: 370 },
  { note: 523, bass: 220, accent: true },
  { note: 440 },
  { note: 370, harmony: 587 },
  {},
];

function getTankBattleAudioContext() {
  if (typeof window === "undefined") return null;
  if (tankBattleAudioContext && tankBattleAudioContext.state !== "closed") return tankBattleAudioContext;
  const audioWindow = window as AudioWindow;
  const AudioContextConstructor = audioWindow.AudioContext ?? audioWindow.webkitAudioContext;
  if (!AudioContextConstructor) return null;
  tankBattleAudioContext = new AudioContextConstructor();
  tankBattleMasterGain = null;
  return tankBattleAudioContext;
}

function getTankBattleMasterGain(ctx: AudioContext) {
  if (!tankBattleMasterGain) {
    tankBattleMasterGain = ctx.createGain();
    tankBattleMasterGain.gain.value = 0.42;
    tankBattleMasterGain.connect(ctx.destination);
  }
  return tankBattleMasterGain;
}

function unlockTankBattleAudio() {
  const ctx = getTankBattleAudioContext();
  if (!ctx) return null;
  if (ctx.state === "suspended") {
    void ctx.resume().catch(() => undefined);
  }
  return ctx;
}

function requestTankBattleLandscapeMode() {
  if (typeof window === "undefined") return;
  const shouldRequest = window.matchMedia("(max-width: 900px)").matches || navigator.maxTouchPoints > 0;
  if (!shouldRequest) return;

  const orientation = window.screen.orientation as LockableScreenOrientation | undefined;
  const lockLandscape = () => {
    const lock = orientation?.lock?.bind(orientation);
    if (!lock) return;
    void lock("landscape-primary").catch(() => lock("landscape").catch(() => undefined));
  };
  const element = document.documentElement as FullscreenElement;
  const requestFullscreen = element.requestFullscreen?.bind(element) ?? element.webkitRequestFullscreen?.bind(element);
  if (!document.fullscreenElement && requestFullscreen) {
    void requestFullscreen().then(lockLandscape).catch(lockLandscape);
    return;
  }
  lockLandscape();
}

function readTankBattleMobileFrame(): TankBattleMobileFrame | null {
  if (typeof window === "undefined") return null;
  const visualViewport = window.visualViewport;
  const viewportWidth = Math.round(visualViewport?.width || window.innerWidth || 0);
  const viewportHeight = Math.round(visualViewport?.height || window.innerHeight || 0);
  const viewportLeft = Math.round(visualViewport?.offsetLeft || 0);
  const viewportTop = Math.round(visualViewport?.offsetTop || 0);
  const fallbackWidth = Number.isFinite(window.screen?.width) ? window.screen.width : viewportWidth;
  const fallbackHeight = Number.isFinite(window.screen?.height) ? window.screen.height : viewportHeight;
  const shortestSide = Math.min(
    Math.max(1, viewportWidth),
    Math.max(1, viewportHeight),
    Math.max(1, fallbackWidth),
    Math.max(1, fallbackHeight),
  );
  const isMobile =
    typeof window.matchMedia === "function"
      ? window.matchMedia("(max-width: 900px), (pointer: coarse) and (max-width: 1024px)").matches ||
        (window.matchMedia("(pointer: coarse)").matches && shortestSide <= 900)
      : window.innerWidth <= 900;
  if (!isMobile) return null;
  const rotateShell = viewportWidth < viewportHeight;
  const safeViewportWidth = Math.max(1, viewportWidth);
  const safeViewportHeight = Math.max(1, viewportHeight);
  return {
    width: rotateShell ? safeViewportHeight : safeViewportWidth,
    height: rotateShell ? safeViewportWidth : safeViewportHeight,
    viewportWidth: safeViewportWidth,
    viewportHeight: safeViewportHeight,
    viewportLeft,
    viewportTop,
    rotateShell,
  };
}

function scheduleTankBattleTone(
  ctx: AudioContext,
  {
    type = "square",
    frequency,
    endFrequency,
    delay = 0,
    duration,
    gain = 0.08,
  }: {
    type?: OscillatorType;
    frequency: number;
    endFrequency?: number;
    delay?: number;
    duration: number;
    gain?: number;
  },
) {
  const start = ctx.currentTime + delay;
  const stop = start + duration;
  const oscillator = ctx.createOscillator();
  const gainNode = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(Math.max(1, frequency), start);
  if (endFrequency !== undefined) {
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, endFrequency), stop);
  }
  gainNode.gain.setValueAtTime(0.0001, start);
  gainNode.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain), start + 0.01);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, stop);
  oscillator.connect(gainNode);
  gainNode.connect(getTankBattleMasterGain(ctx));
  oscillator.start(start);
  oscillator.stop(stop + 0.02);
}

function scheduleTankBattleNoise(
  ctx: AudioContext,
  {
    delay = 0,
    duration,
    gain = 0.08,
    frequency = 900,
    type = "lowpass",
  }: {
    delay?: number;
    duration: number;
    gain?: number;
    frequency?: number;
    type?: BiquadFilterType;
  },
) {
  const start = ctx.currentTime + delay;
  const frameCount = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, frameCount, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < frameCount; index += 1) {
    const decay = 1 - index / frameCount;
    data[index] = (Math.random() * 2 - 1) * decay;
  }
  const source = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const gainNode = ctx.createGain();
  source.buffer = buffer;
  filter.type = type;
  filter.frequency.setValueAtTime(frequency, start);
  gainNode.gain.setValueAtTime(0.0001, start);
  gainNode.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain), start + 0.006);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  source.connect(filter);
  filter.connect(gainNode);
  gainNode.connect(getTankBattleMasterGain(ctx));
  source.start(start);
  source.stop(start + duration + 0.02);
}

function playTankBattleSound(name: TankBattleSoundName) {
  const ctx = unlockTankBattleAudio();
  if (!ctx) return;
  if (name === "menu") {
    scheduleTankBattleTone(ctx, { type: "triangle", frequency: 520, endFrequency: 700, duration: 0.09, gain: 0.045 });
  } else if (name === "start") {
    scheduleTankBattleTone(ctx, { type: "square", frequency: 220, endFrequency: 330, duration: 0.09, gain: 0.055 });
    scheduleTankBattleTone(ctx, { type: "square", frequency: 440, endFrequency: 660, delay: 0.08, duration: 0.11, gain: 0.055 });
  } else if (name === "pause") {
    scheduleTankBattleTone(ctx, { type: "triangle", frequency: 420, endFrequency: 210, duration: 0.12, gain: 0.05 });
  } else if (name === "resume") {
    scheduleTankBattleTone(ctx, { type: "triangle", frequency: 260, endFrequency: 520, duration: 0.12, gain: 0.05 });
  } else if (name === "shoot") {
    scheduleTankBattleTone(ctx, { type: "square", frequency: 520, endFrequency: 130, duration: 0.08, gain: 0.075 });
    scheduleTankBattleNoise(ctx, { duration: 0.05, gain: 0.035, frequency: 1600, type: "bandpass" });
  } else if (name === "enemyShoot") {
    scheduleTankBattleTone(ctx, { type: "square", frequency: 280, endFrequency: 90, duration: 0.07, gain: 0.035 });
  } else if (name === "hit") {
    scheduleTankBattleNoise(ctx, { duration: 0.07, gain: 0.055, frequency: 1400, type: "bandpass" });
    scheduleTankBattleTone(ctx, { type: "triangle", frequency: 180, endFrequency: 80, duration: 0.08, gain: 0.035 });
  } else if (name === "destroy") {
    scheduleTankBattleNoise(ctx, { duration: 0.18, gain: 0.11, frequency: 620 });
    scheduleTankBattleTone(ctx, { type: "sawtooth", frequency: 140, endFrequency: 42, duration: 0.2, gain: 0.085 });
  } else if (name === "bomb") {
    scheduleTankBattleNoise(ctx, { duration: 0.32, gain: 0.15, frequency: 480 });
    scheduleTankBattleTone(ctx, { type: "sawtooth", frequency: 170, endFrequency: 32, duration: 0.34, gain: 0.1 });
    scheduleTankBattleTone(ctx, { type: "square", frequency: 70, endFrequency: 36, delay: 0.06, duration: 0.24, gain: 0.08 });
  } else if (name === "powerupSpawn") {
    scheduleTankBattleTone(ctx, { type: "sine", frequency: 760, endFrequency: 1040, duration: 0.1, gain: 0.035 });
  } else if (name === "powerup") {
    scheduleTankBattleTone(ctx, { type: "triangle", frequency: 520, duration: 0.08, gain: 0.06 });
    scheduleTankBattleTone(ctx, { type: "triangle", frequency: 780, delay: 0.06, duration: 0.08, gain: 0.06 });
    scheduleTankBattleTone(ctx, { type: "triangle", frequency: 1040, delay: 0.12, duration: 0.1, gain: 0.055 });
  } else if (name === "playerDown") {
    scheduleTankBattleNoise(ctx, { duration: 0.18, gain: 0.08, frequency: 760 });
    scheduleTankBattleTone(ctx, { type: "sawtooth", frequency: 260, endFrequency: 58, duration: 0.24, gain: 0.07 });
  } else if (name === "baseDown") {
    scheduleTankBattleNoise(ctx, { duration: 0.38, gain: 0.14, frequency: 520 });
    scheduleTankBattleTone(ctx, { type: "sawtooth", frequency: 120, endFrequency: 26, duration: 0.42, gain: 0.1 });
  } else if (name === "stageClear") {
    [392, 523, 659, 784].forEach((frequency, index) => {
      scheduleTankBattleTone(ctx, { type: "square", frequency, delay: index * 0.07, duration: 0.11, gain: 0.05 });
    });
  } else if (name === "gameOver") {
    scheduleTankBattleTone(ctx, { type: "triangle", frequency: 240, endFrequency: 90, duration: 0.28, gain: 0.07 });
    scheduleTankBattleTone(ctx, { type: "triangle", frequency: 150, endFrequency: 48, delay: 0.18, duration: 0.32, gain: 0.06 });
  }
}

function playTankBattlePowerupSound(type: PowerupType) {
  const ctx = unlockTankBattleAudio();
  if (!ctx) return;
  if (type === "helmet") {
    scheduleTankBattleTone(ctx, { type: "triangle", frequency: 420, duration: 0.07, gain: 0.045 });
    scheduleTankBattleTone(ctx, { type: "triangle", frequency: 620, delay: 0.06, duration: 0.09, gain: 0.045 });
    scheduleTankBattleTone(ctx, { type: "sine", frequency: 930, delay: 0.14, duration: 0.14, gain: 0.032 });
  } else if (type === "star") {
    [523, 659, 784, 1047].forEach((frequency, index) => {
      scheduleTankBattleTone(ctx, { type: "square", frequency, delay: index * 0.045, duration: 0.07, gain: 0.046 });
    });
  } else if (type === "bomb") {
    scheduleTankBattleTone(ctx, { type: "sawtooth", frequency: 160, endFrequency: 46, duration: 0.22, gain: 0.08 });
    scheduleTankBattleNoise(ctx, { delay: 0.04, duration: 0.18, gain: 0.09, frequency: 520 });
  } else if (type === "clock") {
    [900, 620, 900, 620].forEach((frequency, index) => {
      scheduleTankBattleTone(ctx, { type: "square", frequency, delay: index * 0.055, duration: 0.035, gain: 0.038 });
    });
  } else if (type === "shovel") {
    scheduleTankBattleNoise(ctx, { duration: 0.08, gain: 0.05, frequency: 2400, type: "highpass" });
    scheduleTankBattleTone(ctx, { type: "triangle", frequency: 180, endFrequency: 120, delay: 0.03, duration: 0.11, gain: 0.046 });
    scheduleTankBattleTone(ctx, { type: "square", frequency: 260, delay: 0.11, duration: 0.06, gain: 0.034 });
  } else if (type === "tank") {
    [392, 523, 659, 784, 1047].forEach((frequency, index) => {
      scheduleTankBattleTone(ctx, { type: "triangle", frequency, delay: index * 0.04, duration: 0.075, gain: 0.048 });
    });
  }
}

function scheduleTankBattleMusicStep(ctx: AudioContext) {
  const step = tankBattleMusicPattern[tankBattleMusicStep % tankBattleMusicPattern.length] ?? {};
  if (step.note) {
    scheduleTankBattleTone(ctx, {
      type: "square",
      frequency: step.note,
      duration: step.accent ? 0.1 : 0.075,
      gain: step.accent ? 0.022 : 0.016,
    });
  }
  if (step.harmony) {
    scheduleTankBattleTone(ctx, {
      type: "triangle",
      frequency: step.harmony,
      delay: 0.012,
      duration: 0.07,
      gain: 0.009,
    });
  }
  if (step.bass) {
    scheduleTankBattleTone(ctx, {
      type: "triangle",
      frequency: step.bass,
      duration: 0.13,
      gain: 0.018,
    });
  }
  if (tankBattleMusicStep % 4 === 0) {
    scheduleTankBattleNoise(ctx, { duration: 0.026, gain: 0.008, frequency: 1900, type: "highpass" });
  } else if (tankBattleMusicStep % 4 === 2) {
    scheduleTankBattleNoise(ctx, { duration: 0.018, gain: 0.005, frequency: 2600, type: "highpass" });
  }
  tankBattleMusicStep += 1;
}

function setTankBattleBackgroundMusic(active: boolean) {
  if (tankBattleMusicActive === active) return;
  tankBattleMusicActive = active;
  if (!active) {
    if (tankBattleMusicTimer !== null) {
      window.clearInterval(tankBattleMusicTimer);
      tankBattleMusicTimer = null;
    }
    return;
  }

  const ctx = unlockTankBattleAudio();
  if (!ctx) {
    tankBattleMusicActive = false;
    return;
  }
  scheduleTankBattleMusicStep(ctx);
  tankBattleMusicTimer = window.setInterval(() => {
    if (!tankBattleMusicActive || !tankBattleAudioContext || tankBattleAudioContext.state === "closed") return;
    if (tankBattleAudioContext.state === "suspended") return;
    scheduleTankBattleMusicStep(tankBattleAudioContext);
  }, 132);
}

function stopTankBattleBackgroundMusic() {
  tankBattleMusicActive = false;
  if (tankBattleMusicTimer !== null) {
    window.clearInterval(tankBattleMusicTimer);
    tankBattleMusicTimer = null;
  }
}

function setTankBattleEngineAudio(active: boolean) {
  if (tankBattleEngineActive === active) return;
  tankBattleEngineActive = active;
  const ctx = tankBattleAudioContext;
  if (!ctx || ctx.state === "closed") return;
  const now = ctx.currentTime;
  if (!tankBattleEngineOscillator || !tankBattleEngineGain) {
    tankBattleEngineOscillator = ctx.createOscillator();
    tankBattleEngineGain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    tankBattleEngineOscillator.type = "sawtooth";
    tankBattleEngineOscillator.frequency.value = 58;
    filter.type = "lowpass";
    filter.frequency.value = 180;
    tankBattleEngineGain.gain.value = 0.0001;
    tankBattleEngineOscillator.connect(filter);
    filter.connect(tankBattleEngineGain);
    tankBattleEngineGain.connect(getTankBattleMasterGain(ctx));
    tankBattleEngineOscillator.start();
  }
  tankBattleEngineGain.gain.cancelScheduledValues(now);
  tankBattleEngineGain.gain.setTargetAtTime(active ? 0.026 : 0.0001, now, active ? 0.035 : 0.06);
}

function stopTankBattleEngineAudio() {
  tankBattleEngineActive = false;
  tankBattleEngineGain?.disconnect();
  try {
    tankBattleEngineOscillator?.stop();
  } catch {
    // Oscillator may already have been stopped by the browser.
  }
  tankBattleEngineOscillator = null;
  tankBattleEngineGain = null;
}

function createTankBattleSoundSnapshot(state: GameState): TankBattleSoundSnapshot {
  return {
    status: state.status,
    stage: state.stage,
    baseAlive: state.baseAlive,
    destroyedEnemies: state.destroyedEnemies,
    bulletIds: new Set(state.bullets.map((bullet) => bullet.id)),
    powerupIds: new Set(state.powerups.map((powerup) => powerup.id)),
    sparkIds: new Set(state.sparks.map((spark) => spark.id)),
    p1Lives: state.players[0]?.lives ?? 0,
    p2Lives: state.players[1]?.lives ?? 0,
    p1Power: state.players[0]?.power ?? 1,
    p2Power: state.players[1]?.power ?? 1,
    p1Active: Boolean(state.players[0]?.active),
    p2Active: Boolean(state.players[1]?.active),
    totalScore: state.players.reduce((sum, player) => sum + player.score, 0),
    message: state.message,
    lastPowerupPickupId: state.lastPowerupPickup?.id ?? "",
    lastPowerupPickupType: state.lastPowerupPickup?.type ?? null,
  };
}

function playTankBattleStateSounds(previous: TankBattleSoundSnapshot | null, state: GameState) {
  const current = createTankBattleSoundSnapshot(state);
  if (!previous) return current;

  const newBullets = state.bullets.filter((bullet) => !previous.bulletIds.has(bullet.id));
  newBullets.slice(0, 3).forEach((bullet) => {
    playTankBattleSound(bullet.ownerKind === "player" ? "shoot" : "enemyShoot");
  });

  const enemyDestroyedDelta = current.destroyedEnemies - previous.destroyedEnemies;
  const playerLostLife = current.p1Lives < previous.p1Lives || current.p2Lives < previous.p2Lives || previous.p1Active !== current.p1Active || previous.p2Active !== current.p2Active;
  const baseDestroyed = previous.baseAlive && !current.baseAlive;
  const newSparkCount = state.sparks.filter((spark) => !previous.sparkIds.has(spark.id)).length;
  const spawnedPowerup = state.powerups.some((powerup) => !previous.powerupIds.has(powerup.id));
  const playedPowerupPickup = Boolean(
    current.lastPowerupPickupId &&
      current.lastPowerupPickupId !== previous.lastPowerupPickupId &&
      current.lastPowerupPickupType,
  );

  if (spawnedPowerup) playTankBattleSound("powerupSpawn");
  if (playedPowerupPickup && current.lastPowerupPickupType) playTankBattlePowerupSound(current.lastPowerupPickupType);
  if (enemyDestroyedDelta > 0) playTankBattleSound(enemyDestroyedDelta > 1 ? "bomb" : "destroy");
  if (playerLostLife) playTankBattleSound("playerDown");
  if (baseDestroyed) playTankBattleSound("baseDown");
  if (newSparkCount > 0 && enemyDestroyedDelta <= 0 && !playerLostLife && !baseDestroyed) playTankBattleSound("hit");

  if (previous.status !== current.status) {
    if (current.status === "playing") playTankBattleSound("start");
    if (current.status === "stage-clear") playTankBattleSound("stageClear");
    if (current.status === "game-over" && !baseDestroyed) playTankBattleSound("gameOver");
  } else if (previous.stage !== current.stage && current.status === "playing") {
    playTankBattleSound("start");
  }

  if (!playedPowerupPickup && (current.p1Power > previous.p1Power || current.p2Power > previous.p2Power || current.p1Lives > previous.p1Lives || current.p2Lives > previous.p2Lives)) {
    playTankBattleSound("powerup");
  }

  return current;
}
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
  const twoPlayers = mode === "online-host" || mode === "online-guest";
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
    lastPowerupPickup: null,
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
    player.invincible = Math.max(player.invincible, 10);
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
    state.shovelUntil = state.time + 14;
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
  const spawnNumber = state.spawnedEnemies + 1;
  const bonus = spawnNumber % 4 === 0 || (state.stage >= 7 && spawnNumber % 7 === 0);
  const enemy: Tank = {
    id: `enemy-${state.stage}-${state.spawnedEnemies}`,
    kind: "enemy",
    bonus,
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
          if (player && (enemy.bonus || seededValue(state.stage + state.destroyedEnemies, enemy.x, enemy.y) > 0.88)) {
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
    state.lastPowerupPickup = { id: picked.id, type: picked.type };
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
  if (state.status !== "playing") {
    if (state.status === "stage-clear") state.time += dt;
    return maybeAdvanceStage(state);
  }
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

type TankBattleRelayResponse = {
  ok?: boolean;
  peers?: number;
  hasHost?: boolean;
  hasGuest?: boolean;
  guestInput?: InputState | null;
  snapshot?: GameState | null;
  error?: string;
};

async function syncTankBattleRelay(payload: {
  roomId: string;
  role: Exclude<OnlineRole, "none">;
  input?: InputState;
  state?: GameState;
}): Promise<TankBattleRelayResponse> {
  const response = await fetch("/api/tank-battle-room", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    cache: "no-store",
    body: JSON.stringify(payload),
  });
  const data = (await response.json().catch(() => ({}))) as TankBattleRelayResponse;
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || `relay_${response.status}`);
  }
  return data;
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
  let bodyColor = tank.color;
  if (tank.kind === "enemy" && tank.bonus) {
    bodyColor = Math.floor(time * 7) % 2 === 0 ? "#fde047" : "#fb7185";
  }
  if (tank.invincible > 0 && Math.floor(time * 8) % 2 === 0) {
    bodyColor = "#f8fafc";
  }
  ctx.save();
  ctx.translate(centerX, centerY);
  const rotation = tank.dir === "up" ? 0 : tank.dir === "right" ? Math.PI / 2 : tank.dir === "down" ? Math.PI : -Math.PI / 2;
  ctx.rotate(rotation);
  ctx.fillStyle = bodyColor;
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
  ctx.fillText(tank.kind === "player" ? String(tank.player) : tank.bonus ? "P" : tank.power > 2 ? "★" : "", 0, size * 0.05);
  ctx.restore();
}

function drawPowerup(ctx: CanvasRenderingContext2D, powerup: Powerup, time: number) {
  const remaining = powerup.expiresAt - time;
  if (remaining < 3 && Math.floor(time * 9) % 2 === 0) return;
  const px = powerup.x * TILE_SIZE;
  const py = powerup.y * TILE_SIZE;
  const size = 26;
  const style = powerupStyles[powerup.type];
  ctx.save();
  ctx.shadowColor = style.background;
  ctx.shadowBlur = Math.max(0, 8 - remaining * 0.2);
  ctx.fillStyle = style.background;
  drawRoundRect(ctx, px, py, size, size, 4);
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "#020617";
  ctx.lineWidth = 2;
  ctx.strokeRect(px + 1, py + 1, size - 2, size - 2);
  ctx.strokeStyle = style.border;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(px + 5, py + 5, size - 10, size - 10);
  ctx.fillStyle = style.foreground;
  ctx.font = powerup.type === "tank" ? "900 9px Arial" : "900 14px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(powerupLabels[powerup.type], px + size / 2, py + size / 2 + 1);
  ctx.restore();
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
  state.powerups.forEach((powerup) => drawPowerup(ctx, powerup, state.time));
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

export default function TankBattleClient({ subtitle = "小工具 / 游戏大厅", lobbyHref = "/game-lobby" }: TankBattleClientProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef<GameState>(createGameState("solo"));
  const keyboardP1Ref = useRef<InputState>(cloneInput(emptyInput));
  const keyboardP2Ref = useRef<InputState>(cloneInput(emptyInput));
  const touchInputRef = useRef<InputState>(cloneInput(emptyInput));
  const remoteInputRef = useRef<InputState>(cloneInput(emptyInput));
  const soundSnapshotRef = useRef<TankBattleSoundSnapshot | null>(null);
  const joystickPointerIdRef = useRef<number | null>(null);
  const joystickDirectionRef = useRef<Direction | null>(null);
  const firePointerIdRef = useRef<number | null>(null);
  const [mobileFrame, setMobileFrame] = useState<TankBattleMobileFrame | null>(readTankBattleMobileFrame);
  const [joystickThumb, setJoystickThumb] = useState({ x: 0, y: 0, active: false });
  const [menuView, setMenuView] = useState<"mode" | "online">("mode");
  const [roomInput, setRoomInput] = useState("");
  const [roomId, setRoomId] = useState("");
  const [onlineRole, setOnlineRole] = useState<OnlineRole>("none");
  const [networkStatus, setNetworkStatus] = useState("未联网");
  const [peers, setPeers] = useState(0);
  const [copied, setCopied] = useState(false);
  const [ui, setUi] = useState<UiState>(() => buildUiState(createGameState("solo"), "", "none", 0, "未联网"));

  const canUseOnline = true;
  const isGuest = onlineRole === "guest";
  const isOnlineHostReady = onlineRole === "host" && ui.status === "ready";
  const hasOnlinePeer = peers >= 2;
  const showModeMenu = menuView === "mode" && onlineRole === "none" && ui.status === "ready";
  const showOnlineMenu = menuView === "online" && ui.status === "ready";
  const showGameOverMenu = ui.status === "game-over";
  const showTouchControls = ui.status === "playing" || ui.status === "paused";
  const showMobileGameHud = ui.status === "playing" || ui.status === "paused";
  const showPauseMenu = ui.status === "paused" && !isGuest;
  const mobileLivesLabel = ui.p2Lives > 0 ? `${ui.p1Lives} / ${ui.p2Lives}` : String(ui.p1Lives);
  const pageStyle = useMemo(
    () =>
      mobileFrame
        ? ({
            "--tank-battle-landscape-width": `${mobileFrame.width}px`,
            "--tank-battle-landscape-height": `${mobileFrame.height}px`,
            "--tank-battle-fixed-viewport-width": `${mobileFrame.viewportWidth}px`,
            "--tank-battle-fixed-viewport-height": `${mobileFrame.viewportHeight}px`,
            "--tank-battle-viewport-left": `${mobileFrame.viewportLeft}px`,
            "--tank-battle-viewport-top": `${mobileFrame.viewportTop}px`,
          } as CSSProperties)
        : undefined,
    [mobileFrame],
  );
  const syncMobileFrame = useCallback(() => {
    const nextFrame = readTankBattleMobileFrame();
    setMobileFrame((current) => {
      if (!current && !nextFrame) return current;
      if (!nextFrame) return null;
      if (
        current &&
        current.width === nextFrame.width &&
        current.height === nextFrame.height &&
        current.viewportWidth === nextFrame.viewportWidth &&
        current.viewportHeight === nextFrame.viewportHeight &&
        current.viewportLeft === nextFrame.viewportLeft &&
        current.viewportTop === nextFrame.viewportTop &&
        current.rotateShell === nextFrame.rotateShell
      ) {
        return current;
      }
      return nextFrame;
    });
  }, []);
  const requestStableLandscapeMode = useCallback(() => {
    requestTankBattleLandscapeMode();
    if (typeof window === "undefined") return;
    window.requestAnimationFrame(syncMobileFrame);
    window.setTimeout(syncMobileFrame, 180);
    window.setTimeout(syncMobileFrame, 420);
  }, [syncMobileFrame]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const frameId = window.requestAnimationFrame(syncMobileFrame);
    return () => window.cancelAnimationFrame(frameId);
  }, [syncMobileFrame]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return;

    const html = document.documentElement;
    const body = document.body;
    const mobileMedia =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(max-width: 900px), (pointer: coarse) and (max-width: 1024px)")
        : null;
    const visualViewport = window.visualViewport;
    let locked = false;
    let scrollY = 0;
    let previousStyles: {
      htmlOverflow: string;
      htmlOverscrollBehavior: string;
      htmlTouchAction: string;
      htmlHeight: string;
      bodyOverflow: string;
      bodyOverscrollBehavior: string;
      bodyTouchAction: string;
      bodyPosition: string;
      bodyTop: string;
      bodyLeft: string;
      bodyRight: string;
      bodyWidth: string;
      bodyHeight: string;
    } | null = null;

    const shouldLock = () => mobileMedia?.matches ?? window.innerWidth <= 900;
    const lockViewport = () => {
      if (locked) return false;
      locked = true;
      scrollY = window.scrollY || window.pageYOffset || 0;
      previousStyles = {
        htmlOverflow: html.style.overflow,
        htmlOverscrollBehavior: html.style.overscrollBehavior,
        htmlTouchAction: html.style.touchAction,
        htmlHeight: html.style.height,
        bodyOverflow: body.style.overflow,
        bodyOverscrollBehavior: body.style.overscrollBehavior,
        bodyTouchAction: body.style.touchAction,
        bodyPosition: body.style.position,
        bodyTop: body.style.top,
        bodyLeft: body.style.left,
        bodyRight: body.style.right,
        bodyWidth: body.style.width,
        bodyHeight: body.style.height,
      };

      html.style.overflow = "hidden";
      html.style.overscrollBehavior = "none";
      html.style.touchAction = "none";
      html.style.height = "100%";
      body.style.overflow = "hidden";
      body.style.overscrollBehavior = "none";
      body.style.touchAction = "none";
      body.style.position = "fixed";
      body.style.top = `-${scrollY}px`;
      body.style.left = "0";
      body.style.right = "0";
      body.style.width = "100%";
      body.style.height = "100%";
      return true;
    };
    const unlockViewport = () => {
      if (!locked || !previousStyles) return;
      locked = false;
      html.style.overflow = previousStyles.htmlOverflow;
      html.style.overscrollBehavior = previousStyles.htmlOverscrollBehavior;
      html.style.touchAction = previousStyles.htmlTouchAction;
      html.style.height = previousStyles.htmlHeight;
      body.style.overflow = previousStyles.bodyOverflow;
      body.style.overscrollBehavior = previousStyles.bodyOverscrollBehavior;
      body.style.touchAction = previousStyles.bodyTouchAction;
      body.style.position = previousStyles.bodyPosition;
      body.style.top = previousStyles.bodyTop;
      body.style.left = previousStyles.bodyLeft;
      body.style.right = previousStyles.bodyRight;
      body.style.width = previousStyles.bodyWidth;
      body.style.height = previousStyles.bodyHeight;
      window.scrollTo(0, scrollY);
      previousStyles = null;
    };
    const syncViewportLock = () => {
      if (shouldLock()) {
        const newlyLocked = lockViewport();
        if (newlyLocked) {
          requestStableLandscapeMode();
        } else {
          window.requestAnimationFrame(syncMobileFrame);
        }
      } else {
        unlockViewport();
        window.requestAnimationFrame(syncMobileFrame);
      }
    };
    const preventDocumentPull = (event: TouchEvent) => {
      if (!locked) return;
      const target = event.target;
      if (target instanceof HTMLElement && target.closest("input, textarea, select, [contenteditable='true']")) return;
      event.preventDefault();
    };

    syncViewportLock();
    mobileMedia?.addEventListener?.("change", syncViewportLock);
    visualViewport?.addEventListener?.("resize", syncViewportLock);
    visualViewport?.addEventListener?.("scroll", syncViewportLock);
    window.addEventListener("resize", syncViewportLock);
    window.addEventListener("orientationchange", syncViewportLock);
    document.addEventListener("visibilitychange", syncViewportLock);
    document.addEventListener("touchmove", preventDocumentPull, { passive: false });

    return () => {
      mobileMedia?.removeEventListener?.("change", syncViewportLock);
      visualViewport?.removeEventListener?.("resize", syncViewportLock);
      visualViewport?.removeEventListener?.("scroll", syncViewportLock);
      window.removeEventListener("resize", syncViewportLock);
      window.removeEventListener("orientationchange", syncViewportLock);
      document.removeEventListener("visibilitychange", syncViewportLock);
      document.removeEventListener("touchmove", preventDocumentPull);
      unlockViewport();
    };
  }, [requestStableLandscapeMode, syncMobileFrame]);

  const resetState = useCallback((mode: GameMode, stage = 1) => {
    stateRef.current = createGameState(mode, stage, undefined, readHighScore());
    stateRef.current.status = mode === "online-guest" ? "ready" : "playing";
    stateRef.current.message = mode === "online-guest" ? "等待房主同步" : `第 ${stage} 关`;
    soundSnapshotRef.current = createTankBattleSoundSnapshot(stateRef.current);
    setUi(buildUiState(stateRef.current, roomId, onlineRole, peers, networkStatus));
  }, [networkStatus, onlineRole, peers, roomId]);

  const startSolo = useCallback(() => {
    requestStableLandscapeMode();
    playTankBattleSound("start");
    setMenuView("mode");
    setOnlineRole("none");
    setRoomId("");
    setRoomInput("");
    setNetworkStatus("未联网");
    setPeers(0);
    resetState("solo");
  }, [requestStableLandscapeMode, resetState]);

  const showOnlineSetup = useCallback(() => {
    requestStableLandscapeMode();
    playTankBattleSound("menu");
    setMenuView("online");
    setOnlineRole("none");
    setRoomId("");
    setNetworkStatus("未联网");
    setPeers(0);
  }, [requestStableLandscapeMode]);

  const startHost = useCallback(() => {
    requestStableLandscapeMode();
    playTankBattleSound("menu");
    const nextRoom = createRoomId();
    setMenuView("online");
    setRoomId(nextRoom);
    setRoomInput(nextRoom);
    setOnlineRole("host");
    setNetworkStatus("创建房间中");
    setPeers(1);
    stateRef.current = createGameState("online-host", 1, undefined, readHighScore());
    stateRef.current.status = "ready";
    stateRef.current.message = `房间 ${nextRoom}，等待玩家二`;
    soundSnapshotRef.current = createTankBattleSoundSnapshot(stateRef.current);
    setUi(buildUiState(stateRef.current, nextRoom, "host", 1, "创建房间中"));
  }, [requestStableLandscapeMode]);

  const startOnlineHostGame = useCallback(() => {
    if (onlineRole !== "host" || !roomId || !hasOnlinePeer) return;
    requestStableLandscapeMode();
    playTankBattleSound("start");
    stateRef.current = createGameState("online-host", 1, undefined, readHighScore());
    stateRef.current.status = "playing";
    stateRef.current.message = `第 1 关`;
    soundSnapshotRef.current = createTankBattleSoundSnapshot(stateRef.current);
    setUi(buildUiState(stateRef.current, roomId, "host", peers, networkStatus));
  }, [hasOnlinePeer, networkStatus, onlineRole, peers, requestStableLandscapeMode, roomId]);

  const joinRoom = useCallback((targetRoom?: string) => {
    const nextRoom = normalizeRoomId(targetRoom ?? roomInput);
    if (!nextRoom) {
      setNetworkStatus("请输入房间号");
      return;
    }
    requestStableLandscapeMode();
    playTankBattleSound("menu");
    setMenuView("online");
    setRoomId(nextRoom);
    setRoomInput(nextRoom);
    setOnlineRole("guest");
    setNetworkStatus("加入房间中");
    setPeers(1);
    stateRef.current = createGameState("online-guest", 1, undefined, readHighScore());
    stateRef.current.message = `等待房主 ${nextRoom}`;
    soundSnapshotRef.current = createTankBattleSoundSnapshot(stateRef.current);
    setUi(buildUiState(stateRef.current, nextRoom, "guest", 1, "加入房间中"));
  }, [requestStableLandscapeMode, roomInput]);

  const pauseOrResume = useCallback(() => {
    if (isGuest) return;
    const state = stateRef.current;
    if (state.status === "playing") {
      state.status = "paused";
      state.message = "暂停";
      playTankBattleSound("pause");
    } else if (state.status === "paused") {
      state.status = "playing";
      state.message = `第 ${state.stage} 关`;
      playTankBattleSound("resume");
    }
    setUi(buildUiState(state, roomId, onlineRole, peers, networkStatus));
  }, [isGuest, networkStatus, onlineRole, peers, roomId]);

  const exitGame = useCallback(() => {
    playTankBattleSound("menu");
    stopTankBattleEngineAudio();
    stopTankBattleBackgroundMusic();
    touchInputRef.current = cloneInput(emptyInput);
    keyboardP1Ref.current = cloneInput(emptyInput);
    keyboardP2Ref.current = cloneInput(emptyInput);
    remoteInputRef.current = cloneInput(emptyInput);
    setJoystickThumb({ x: 0, y: 0, active: false });
    setMenuView("mode");
    setOnlineRole("none");
    setRoomId("");
    setRoomInput("");
    setNetworkStatus("未联网");
    setPeers(0);
    const nextState = createGameState("solo", 1, undefined, readHighScore());
    nextState.status = "ready";
    nextState.message = "选择模式后开始";
    stateRef.current = nextState;
    soundSnapshotRef.current = createTankBattleSoundSnapshot(nextState);
    setUi(buildUiState(nextState, "", "none", 0, "未联网"));
  }, []);

  const returnToGameLobby = useCallback(() => {
    exitGame();
    if (typeof window === "undefined") return;
    writeTankBattleLobbyReturnTarget(lobbyHref);
    const targetUrl = new URL(lobbyHref, window.location.origin).toString();
    window.location.assign(targetUrl);
  }, [exitGame, lobbyHref]);

  const restartCurrent = useCallback(() => {
    if (isGuest) return;
    requestStableLandscapeMode();
    playTankBattleSound("start");
    const mode = stateRef.current.mode === "online-guest" ? "solo" : stateRef.current.mode;
    resetState(mode, stateRef.current.stage);
  }, [isGuest, requestStableLandscapeMode, resetState]);

  const copyRoomLink = useCallback(async () => {
    if (!roomId || typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("room", roomId);
    url.searchParams.set("role", "guest");
    try {
      await navigator.clipboard.writeText(url.toString());
      playTankBattleSound("menu");
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }, [roomId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    requestStableLandscapeMode();
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
  }, [joinRoom, requestStableLandscapeMode]);

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
      if (handled) {
        if (pressed) unlockTankBattleAudio();
        event.preventDefault();
      }
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

    let stopped = false;
    let timer = 0;
    let inFlight = false;
    const delay = onlineRole === "host" ? 90 : 70;

    const sync = async () => {
      if (stopped || inFlight) return;
      inFlight = true;
      try {
        const response = await syncTankBattleRelay({
          roomId,
          role: onlineRole,
          input: onlineRole === "guest" ? mergeInput(keyboardP2Ref.current, touchInputRef.current) : undefined,
          state: onlineRole === "host" ? serializeState(stateRef.current) : undefined,
        });
        if (stopped) return;
        const nextPeers = typeof response.peers === "number" ? response.peers : 0;
        setPeers(nextPeers);
        if (onlineRole === "host") {
          remoteInputRef.current = response.hasGuest && response.guestInput ? cloneInput(response.guestInput) : cloneInput(emptyInput);
          setNetworkStatus(response.hasGuest ? "已连接" : "等待玩家二");
        } else {
          if (response.snapshot) {
            stateRef.current = response.snapshot;
          }
          setNetworkStatus(response.hasHost ? "已加入房间" : "等待房主");
        }
      } catch {
        if (!stopped) setNetworkStatus("联网中转异常");
      } finally {
        inFlight = false;
        if (!stopped) {
          timer = window.setTimeout(sync, delay);
        }
      }
    };

    void sync();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      setPeers(0);
    };
  }, [onlineRole, roomId]);

  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    let lastUi = 0;
    const tick = (now: number) => {
      const dt = Math.min(0.045, Math.max(0.001, (now - last) / 1000));
      last = now;
      const state = stateRef.current;
      if (onlineRole !== "guest") {
        const p1Touch = touchInputRef.current;
        const p1Input = mergeInput(keyboardP1Ref.current, p1Touch);
        const p2Input = onlineRole === "host" ? remoteInputRef.current : emptyInput;
        stateRef.current = updateGameState(state, dt, p1Input, p2Input);
      } else {
        stateRef.current.time += dt;
      }
      const p1MovementInput = onlineRole === "guest" ? emptyInput : mergeInput(keyboardP1Ref.current, touchInputRef.current);
      const p2MovementInput = onlineRole === "guest" ? mergeInput(keyboardP2Ref.current, touchInputRef.current) : emptyInput;
      const localMovementInput = mergeInput(p1MovementInput, p2MovementInput);
      setTankBattleEngineAudio(stateRef.current.status === "playing" && inputDirection(localMovementInput) !== null);
      setTankBattleBackgroundMusic(stateRef.current.status === "playing");
      soundSnapshotRef.current = playTankBattleStateSounds(soundSnapshotRef.current, stateRef.current);
      const ctx = canvasRef.current?.getContext("2d");
      if (ctx) drawGame(ctx, stateRef.current);
      if (now - lastUi > 120) {
        lastUi = now;
        setUi(buildUiState(stateRef.current, roomId, onlineRole, peers, networkStatus));
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      stopTankBattleEngineAudio();
      stopTankBattleBackgroundMusic();
    };
  }, [networkStatus, onlineRole, peers, roomId]);

  const modeLabel = useMemo(() => {
    if (ui.mode === "solo") return "单人";
    if (ui.mode === "online-host") return "联网房主";
    return "联网加入";
  }, [ui.mode]);

  const setTouch = (patch: Partial<InputState>) => {
    touchInputRef.current = { ...touchInputRef.current, ...patch };
  };

  const applyJoystickDirection = (direction: Direction | null) => {
    joystickDirectionRef.current = direction;
    setTouch({
      up: direction === "up",
      down: direction === "down",
      left: direction === "left",
      right: direction === "right",
    });
  };

  const applyJoystickVector = (rawX: number, rawY: number) => {
    const maxRadius = 44;
    const deadZone = 8;
    const distance = Math.hypot(rawX, rawY);
    const scale = distance > maxRadius ? maxRadius / distance : 1;
    const x = rawX * scale;
    const y = rawY * scale;
    setJoystickThumb({ x, y, active: distance > deadZone });

    if (distance < deadZone) {
      applyJoystickDirection(null);
      return;
    }

    const angle = Math.atan2(y, x);
    const nextDirection =
      angle >= -Math.PI * 0.25 && angle < Math.PI * 0.25
        ? "right"
        : angle >= Math.PI * 0.25 && angle < Math.PI * 0.75
          ? "down"
          : angle <= -Math.PI * 0.25 && angle > -Math.PI * 0.75
            ? "up"
            : "left";
    applyJoystickDirection(nextDirection);
  };

  const updateJoystickFromPointer = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const screenX = event.clientX - rect.left - rect.width / 2;
    const screenY = event.clientY - rect.top - rect.height / 2;

    if (mobileFrame?.rotateShell) {
      applyJoystickVector(screenY, -screenX);
      return;
    }

    applyJoystickVector(screenX, screenY);
  };

  const handleJoystickDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    requestStableLandscapeMode();
    unlockTankBattleAudio();
    joystickPointerIdRef.current = event.pointerId;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic or interrupted pointer events may not be capturable.
    }
    updateJoystickFromPointer(event);
  };

  const handleJoystickMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (joystickPointerIdRef.current !== event.pointerId) return;
    updateJoystickFromPointer(event);
  };

  const clearJoystick = (event?: ReactPointerEvent<HTMLButtonElement>) => {
    if (event) {
      event.preventDefault();
      try {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      } catch {
        // Ignore pointer capture cleanup races.
      }
    }
    joystickPointerIdRef.current = null;
    joystickDirectionRef.current = null;
    setJoystickThumb({ x: 0, y: 0, active: false });
    setTouch({ up: false, down: false, left: false, right: false });
  };

  const handleFireDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    requestStableLandscapeMode();
    unlockTankBattleAudio();
    firePointerIdRef.current = event.pointerId;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic or interrupted pointer events may not be capturable.
    }
    setTouch({ fire: true });
  };

  const clearFire = (event?: ReactPointerEvent<HTMLButtonElement>) => {
    if (event) {
      event.preventDefault();
      try {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      } catch {
        // Ignore pointer capture cleanup races.
      }
    }
    firePointerIdRef.current = null;
    setTouch({ fire: false });
  };

  return (
    <main
      data-mobile-swipe-back-ignore
      data-tank-battle-mobile={mobileFrame ? "true" : "false"}
      data-tank-battle-rotated={mobileFrame?.rotateShell ? "true" : "false"}
      className="tank-battle-page min-h-screen bg-[#eef2f3] px-3 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] pt-[calc(env(safe-area-inset-top)+0.9rem)] text-slate-950"
      style={pageStyle}
    >
      <style jsx global>{`
        .tank-battle-page {
          overscroll-behavior: none;
          touch-action: none;
          user-select: none;
          -webkit-user-select: none;
        }

        .tank-battle-page input,
        .tank-battle-page textarea,
        .tank-battle-page select {
          touch-action: manipulation;
          user-select: text;
          -webkit-user-select: text;
        }

        .tank-battle-menu-overlay {
          position: absolute;
          inset: 0.75rem;
          z-index: 5;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 18px;
          background: radial-gradient(circle at center, rgba(15, 23, 42, 0.2), rgba(2, 6, 23, 0.66));
        }

        .tank-battle-mobile-hud,
        .tank-battle-mobile-pause-button {
          display: none;
        }

        .tank-battle-page[data-tank-battle-mobile="true"] {
          position: fixed;
          left: var(--tank-battle-viewport-left, 0);
          top: var(--tank-battle-viewport-top, 0);
          right: auto;
          bottom: auto;
          height: var(--tank-battle-fixed-viewport-height, 100dvh);
          min-height: var(--tank-battle-fixed-viewport-height, 100dvh);
          width: var(--tank-battle-fixed-viewport-width, 100dvw);
          min-width: var(--tank-battle-fixed-viewport-width, 100dvw);
          overflow: hidden;
          padding: 0;
          background: #020617;
          overscroll-behavior: none;
        }

        .tank-battle-page[data-tank-battle-mobile="true"] .tank-battle-shell {
          position: fixed;
          left: 0;
          top: 0;
          height: var(--tank-battle-landscape-height, min(100dvw, 100dvh));
          width: var(--tank-battle-landscape-width, max(100dvw, 100dvh));
          max-width: none;
          gap: 0;
          overflow: hidden;
          overscroll-behavior: none;
          touch-action: none;
          backface-visibility: hidden;
          transform: translate3d(0, 0, 0);
          transform-origin: top left;
          will-change: transform;
        }

        .tank-battle-page[data-tank-battle-mobile="true"][data-tank-battle-rotated="true"] .tank-battle-shell {
          transform: rotate(90deg) translate3d(0, -100%, 0);
        }

        .tank-battle-page[data-tank-battle-mobile="true"] .tank-battle-header,
        .tank-battle-page[data-tank-battle-mobile="true"] .tank-battle-stats,
        .tank-battle-page[data-tank-battle-mobile="true"] .tank-battle-mode-controls,
        .tank-battle-page[data-tank-battle-mobile="true"] .tank-battle-sidebar,
        .tank-battle-page[data-tank-battle-mobile="true"] .tank-battle-footer {
          display: none !important;
        }

        .tank-battle-page[data-tank-battle-mobile="true"] .tank-battle-layout {
          display: block;
          height: var(--tank-battle-landscape-height, min(100dvw, 100dvh));
        }

        .tank-battle-page[data-tank-battle-mobile="true"] .tank-battle-stage-card {
          position: relative;
          height: var(--tank-battle-landscape-height, min(100dvw, 100dvh));
          overflow: hidden;
          border: 0;
          border-radius: 0;
          background: #020617;
          padding: 0;
          box-shadow: none;
          overscroll-behavior: none;
          touch-action: none;
        }

        .tank-battle-page[data-tank-battle-mobile="true"] .tank-battle-canvas-wrap {
          height: var(--tank-battle-landscape-height, min(100dvw, 100dvh));
          max-width: none;
          width: var(--tank-battle-landscape-height, min(100dvw, 100dvh));
          padding: 4px;
          border-radius: 0;
          box-shadow: none;
          overflow: hidden;
          overscroll-behavior: none;
          touch-action: none;
        }

        .tank-battle-page[data-tank-battle-mobile="true"] .tank-battle-canvas-wrap canvas {
          border-radius: 0;
          touch-action: none;
        }

        .tank-battle-page[data-tank-battle-mobile="true"] .tank-battle-mobile-controls {
          position: absolute;
          inset: 0;
          display: flex !important;
          align-items: flex-end;
          margin: 0;
          border: 0;
          border-radius: 0;
          background: linear-gradient(90deg, rgba(2, 6, 23, 0.42), transparent 30%, transparent 70%, rgba(2, 6, 23, 0.42));
          padding: 0 18px 16px 18px;
          pointer-events: none;
          box-shadow: none;
          overscroll-behavior: none;
          touch-action: none;
        }

        .tank-battle-page[data-tank-battle-mobile="true"] .tank-battle-mobile-controls > div {
          width: 100%;
          pointer-events: none;
        }

        .tank-battle-page[data-tank-battle-mobile="true"] .tank-battle-mobile-controls button {
          pointer-events: auto;
        }

        .tank-battle-page[data-tank-battle-mobile="true"] .tank-battle-fire-button {
          margin-right: 24px;
        }

        .tank-battle-page[data-tank-battle-mobile="true"] .tank-battle-mobile-controls.is-hidden {
          display: none !important;
        }

        .tank-battle-page[data-tank-battle-mobile="true"] .tank-battle-mobile-hud {
          position: absolute;
          left: 12px;
          top: 10px;
          z-index: 3;
          display: flex;
          flex-direction: column;
          gap: 6px;
          pointer-events: none;
        }

        .tank-battle-page[data-tank-battle-mobile="true"] .tank-battle-mobile-hud > div {
          min-width: 86px;
          border-radius: 14px;
          border: 1px solid rgba(255, 255, 255, 0.14);
          background: rgba(2, 6, 23, 0.68);
          padding: 7px 10px;
          color: #f8fafc;
          box-shadow: 0 10px 22px rgba(2, 6, 23, 0.24);
          backdrop-filter: blur(10px);
        }

        .tank-battle-page[data-tank-battle-mobile="true"] .tank-battle-mobile-pause-button {
          position: absolute;
          right: 12px;
          top: 10px;
          z-index: 4;
          display: inline-flex;
          height: 44px;
          width: 44px;
          align-items: center;
          justify-content: center;
          border-radius: 16px;
          border: 1px solid rgba(255, 255, 255, 0.16);
          background: rgba(2, 6, 23, 0.72);
          color: #f8fafc;
          box-shadow: 0 12px 26px rgba(2, 6, 23, 0.28);
          backdrop-filter: blur(10px);
        }

        .tank-battle-page[data-tank-battle-mobile="true"] .tank-battle-menu-overlay {
          position: absolute;
          inset: 0;
          z-index: 5;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 0;
          background: radial-gradient(circle at center, rgba(15, 23, 42, 0.24), rgba(2, 6, 23, 0.74));
          padding: 16px 18px;
        }

        @media (max-width: 900px), (pointer: coarse) and (max-width: 1024px) {
          .tank-battle-page {
            position: fixed;
            left: var(--tank-battle-viewport-left, 0);
            top: var(--tank-battle-viewport-top, 0);
            right: auto;
            bottom: auto;
            height: var(--tank-battle-fixed-viewport-height, 100dvh);
            min-height: var(--tank-battle-fixed-viewport-height, 100dvh);
            width: var(--tank-battle-fixed-viewport-width, 100dvw);
            min-width: var(--tank-battle-fixed-viewport-width, 100dvw);
            overflow: hidden;
            padding: 0;
            background: #020617;
            overscroll-behavior: none;
          }

          .tank-battle-page .tank-battle-shell {
            position: fixed;
            left: 0;
            top: 0;
            height: var(--tank-battle-landscape-height, min(100dvw, 100dvh));
            width: var(--tank-battle-landscape-width, max(100dvw, 100dvh));
            max-width: none;
            gap: 0;
            overflow: hidden;
            overscroll-behavior: none;
            touch-action: none;
            backface-visibility: hidden;
            transform: translate3d(0, 0, 0);
            transform-origin: top left;
            will-change: transform;
          }

          @media (orientation: portrait) {
            .tank-battle-page .tank-battle-shell {
              transform: rotate(90deg) translate3d(0, -100%, 0);
            }
          }

          .tank-battle-page .tank-battle-header,
          .tank-battle-page .tank-battle-stats,
          .tank-battle-page .tank-battle-mode-controls,
          .tank-battle-page .tank-battle-sidebar,
          .tank-battle-page .tank-battle-footer {
            display: none !important;
          }

          .tank-battle-page .tank-battle-layout {
            display: block;
            height: var(--tank-battle-landscape-height, min(100dvw, 100dvh));
          }

          .tank-battle-page .tank-battle-stage-card {
            position: relative;
            height: var(--tank-battle-landscape-height, min(100dvw, 100dvh));
            overflow: hidden;
            border: 0;
            border-radius: 0;
            background: #020617;
            padding: 0;
            box-shadow: none;
            overscroll-behavior: none;
            touch-action: none;
          }

          .tank-battle-page .tank-battle-canvas-wrap {
            height: var(--tank-battle-landscape-height, min(100dvw, 100dvh));
            max-width: none;
            width: var(--tank-battle-landscape-height, min(100dvw, 100dvh));
            padding: 4px;
            border-radius: 0;
            box-shadow: none;
            overflow: hidden;
            overscroll-behavior: none;
            touch-action: none;
          }

          .tank-battle-page .tank-battle-canvas-wrap canvas {
            border-radius: 0;
            touch-action: none;
          }

          .tank-battle-page .tank-battle-mobile-controls {
            position: absolute;
            inset: 0;
            display: flex !important;
            align-items: flex-end;
            margin: 0;
            border: 0;
            border-radius: 0;
            background: linear-gradient(90deg, rgba(2, 6, 23, 0.42), transparent 30%, transparent 70%, rgba(2, 6, 23, 0.42));
            padding: 0 18px 16px 18px;
            pointer-events: none;
            box-shadow: none;
            overscroll-behavior: none;
            touch-action: none;
          }

          .tank-battle-page .tank-battle-mobile-controls > div {
            width: 100%;
            pointer-events: none;
          }

          .tank-battle-page .tank-battle-mobile-controls button {
            pointer-events: auto;
          }

          .tank-battle-page .tank-battle-fire-button {
            margin-right: 24px;
          }

          .tank-battle-page .tank-battle-mobile-controls.is-hidden {
            display: none !important;
          }

          .tank-battle-page .tank-battle-mobile-hud {
            position: absolute;
            left: 12px;
            top: 10px;
            z-index: 3;
            display: flex;
            flex-direction: column;
            gap: 6px;
            pointer-events: none;
          }

          .tank-battle-page .tank-battle-mobile-hud > div {
            min-width: 86px;
            border-radius: 14px;
            border: 1px solid rgba(255, 255, 255, 0.14);
            background: rgba(2, 6, 23, 0.68);
            padding: 7px 10px;
            color: #f8fafc;
            box-shadow: 0 10px 22px rgba(2, 6, 23, 0.24);
            backdrop-filter: blur(10px);
          }

          .tank-battle-page .tank-battle-mobile-pause-button {
            position: absolute;
            right: 12px;
            top: 10px;
            z-index: 4;
            display: inline-flex;
            height: 44px;
            width: 44px;
            align-items: center;
            justify-content: center;
            border-radius: 16px;
            border: 1px solid rgba(255, 255, 255, 0.16);
            background: rgba(2, 6, 23, 0.72);
            color: #f8fafc;
            box-shadow: 0 12px 26px rgba(2, 6, 23, 0.28);
            backdrop-filter: blur(10px);
          }

          .tank-battle-page .tank-battle-menu-overlay {
            position: absolute;
            inset: 0;
            z-index: 5;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 0;
            background: radial-gradient(circle at center, rgba(15, 23, 42, 0.24), rgba(2, 6, 23, 0.74));
            padding: 16px 18px;
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
          <div className="tank-battle-stage-card relative rounded-[24px] border border-slate-200 bg-white p-3 shadow-[0_14px_34px_rgba(15,23,42,0.08)]">
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

            {showMobileGameHud ? (
              <>
                <div className="tank-battle-mobile-hud" aria-hidden="true">
                  <div>
                    <div className="text-[10px] font-bold text-slate-300">关卡</div>
                    <div className="text-lg font-black leading-none tabular-nums">{ui.stage}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold text-slate-300">生命</div>
                    <div className="text-lg font-black leading-none tabular-nums">{mobileLivesLabel}</div>
                  </div>
                </div>
                {ui.status === "playing" && !isGuest ? (
                  <button
                    type="button"
                    className="tank-battle-mobile-pause-button"
                    onClick={pauseOrResume}
                    aria-label="暂停"
                  >
                    <span className="h-4 w-1.5 rounded-full bg-current" />
                    <span className="ml-1.5 h-4 w-1.5 rounded-full bg-current" />
                  </button>
                ) : null}
              </>
            ) : null}

            {showModeMenu ? (
              <div className="tank-battle-menu-overlay">
                <div className="w-full max-w-[360px] rounded-[26px] border border-white/15 bg-slate-950/92 p-4 text-white shadow-[0_24px_60px_rgba(0,0,0,0.38)] backdrop-blur">
                  <div className="text-center text-2xl font-black">坦克大战</div>
                  <div className="mt-4 grid gap-3">
                    <button
                      type="button"
                      className="rounded-2xl bg-emerald-500 px-4 py-4 text-base font-black text-slate-950 shadow-[0_14px_34px_rgba(16,185,129,0.28)] active:scale-[0.98]"
                      onClick={startSolo}
                    >
                      单人开始
                    </button>
                    <button
                      type="button"
                      className="rounded-2xl bg-sky-500 px-4 py-4 text-base font-black text-slate-950 shadow-[0_14px_34px_rgba(14,165,233,0.28)] active:scale-[0.98]"
                      onClick={showOnlineSetup}
                    >
                      联网双打
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {showOnlineMenu ? (
              <div className="tank-battle-menu-overlay">
                <div className="w-full max-w-[430px] rounded-[26px] border border-white/15 bg-slate-950/94 p-4 text-white shadow-[0_24px_60px_rgba(0,0,0,0.4)] backdrop-blur">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xl font-black">联网双打</div>
                    <button
                      type="button"
                      className="rounded-full border border-white/15 px-3 py-1.5 text-xs font-bold text-slate-200 active:scale-95"
                      onClick={() => {
                        playTankBattleSound("menu");
                        setMenuView("mode");
                        setOnlineRole("none");
                        setRoomId("");
                        setNetworkStatus("未联网");
                      }}
                    >
                      返回
                    </button>
                  </div>

                  {onlineRole === "none" ? (
                    <div className="mt-4 grid gap-3">
                      <div className="grid grid-cols-[1fr_auto] gap-2">
                        <input
                          value={roomInput}
                          onChange={(event) => setRoomInput(normalizeRoomId(event.target.value))}
                          placeholder="房间号"
                          className="min-w-0 rounded-2xl border border-white/15 bg-white/10 px-3 py-3 text-sm font-black uppercase text-white outline-none placeholder:text-slate-400"
                        />
                        <button type="button" className="rounded-2xl bg-sky-500 px-4 py-3 text-sm font-black text-slate-950 active:scale-95" onClick={() => joinRoom()}>
                          加入
                        </button>
                      </div>
                      <button
                        type="button"
                        className="rounded-2xl bg-emerald-500 px-4 py-4 text-base font-black text-slate-950 active:scale-[0.98] disabled:opacity-50"
                        onClick={startHost}
                        disabled={!canUseOnline}
                      >
                        创建房间
                      </button>
                      {!canUseOnline ? <div className="text-center text-xs font-semibold text-rose-200">当前环境未配置联网服务</div> : null}
                    </div>
                  ) : (
                    <div className="mt-4 space-y-3">
                      <div className="rounded-2xl bg-white/10 px-3 py-3 text-sm font-bold">
                        房间 {roomId || "未创建"} · {networkStatus} · {peers} 人在线
                      </div>
                      {onlineRole === "host" ? (
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            className="rounded-2xl border border-white/15 bg-white/10 px-3 py-3 text-sm font-black text-white disabled:opacity-50"
                            onClick={copyRoomLink}
                            disabled={!roomId}
                          >
                            {copied ? "已复制" : "复制邀请"}
                          </button>
                          <button
                            type="button"
                            className="rounded-2xl bg-emerald-500 px-3 py-3 text-sm font-black text-slate-950 disabled:opacity-45"
                            onClick={startOnlineHostGame}
                            disabled={!isOnlineHostReady || !hasOnlinePeer}
                          >
                            开始
                          </button>
                        </div>
                      ) : (
                        <div className="rounded-2xl bg-white/10 px-3 py-3 text-center text-sm font-bold text-slate-200">等待房主开始</div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ) : null}

            {showPauseMenu ? (
              <div className="tank-battle-menu-overlay">
                <div className="w-full max-w-[340px] rounded-[26px] border border-white/15 bg-slate-950/92 p-4 text-center text-white shadow-[0_24px_60px_rgba(0,0,0,0.38)] backdrop-blur">
                  <div className="text-2xl font-black">暂停</div>
                  <div className="mt-4 grid gap-3">
                    <button
                      type="button"
                      className="rounded-2xl bg-emerald-500 px-4 py-4 text-base font-black text-slate-950 active:scale-[0.98]"
                      onClick={pauseOrResume}
                    >
                      继续
                    </button>
                    <button
                      type="button"
                      className="rounded-2xl border border-white/15 bg-white/10 px-4 py-4 text-base font-black text-white active:scale-[0.98]"
                      onClick={exitGame}
                    >
                      退出游戏
                    </button>
                    <button
                      type="button"
                      className="rounded-2xl border border-sky-300/35 bg-sky-500/18 px-4 py-4 text-base font-black text-sky-50 active:scale-[0.98]"
                      onClick={returnToGameLobby}
                    >
                      返回游戏大厅
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {showGameOverMenu ? (
              <div className="tank-battle-menu-overlay">
                <div className="w-full max-w-[340px] rounded-[26px] border border-white/15 bg-slate-950/92 p-4 text-center text-white shadow-[0_24px_60px_rgba(0,0,0,0.38)] backdrop-blur">
                  <div className="text-2xl font-black">游戏结束</div>
                  <div className="mt-2 text-sm font-semibold text-slate-300">总分 {ui.totalScore}</div>
                  {onlineRole === "guest" ? (
                    <div className="mt-4 rounded-2xl bg-white/10 px-3 py-3 text-sm font-bold text-slate-200">等待房主重新开始</div>
                  ) : (
                    <button
                      type="button"
                      className="mt-4 w-full rounded-2xl bg-emerald-500 px-4 py-4 text-base font-black text-slate-950 active:scale-[0.98] disabled:opacity-50"
                      onClick={onlineRole === "host" ? startOnlineHostGame : startSolo}
                      disabled={onlineRole === "host" && !hasOnlinePeer}
                    >
                      重新开始
                    </button>
                  )}
                </div>
              </div>
            ) : null}

            <section className={`tank-battle-mobile-controls mt-2 rounded-[22px] border border-slate-200 bg-slate-950 px-4 py-3 shadow-inner lg:hidden ${showTouchControls ? "" : "is-hidden"}`}>
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
                  <span className="absolute inset-3 rounded-full border border-white/10 bg-[radial-gradient(circle,rgba(255,255,255,0.14)_0%,rgba(255,255,255,0.06)_46%,rgba(15,23,42,0)_72%)]" />
                  <span className="absolute inset-[30px] rounded-full border border-white/10 bg-white/5" />
                  <span
                    className={`absolute left-1/2 top-1/2 h-[50px] w-[50px] rounded-full border border-white/20 bg-slate-100 shadow-[0_10px_24px_rgba(0,0,0,0.28)] ${joystickThumb.active ? "opacity-100" : "opacity-90"}`}
                    style={{ transform: `translate(calc(-50% + ${joystickThumb.x}px), calc(-50% + ${joystickThumb.y}px))` }}
                  />
                </button>

                <button
                  type="button"
                  aria-label="开火"
                  className="tank-battle-fire-button flex h-[76px] w-[76px] shrink-0 touch-none select-none items-center justify-center rounded-full border-[5px] border-rose-300/40 bg-rose-600 text-xl font-black text-white shadow-[0_16px_34px_rgba(190,18,60,0.34)] active:scale-95"
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
              <button type="button" className="rounded-2xl bg-slate-900 px-3 py-3 text-sm font-bold text-white" onClick={showOnlineSetup}>
                联网双打
              </button>
              <button type="button" className="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-bold text-slate-800 disabled:opacity-50" onClick={pauseOrResume} disabled={isGuest || ui.status === "ready"}>
                {ui.status === "paused" ? "继续" : "暂停"}
              </button>
              <button type="button" className="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-bold text-slate-800 disabled:opacity-50" onClick={restartCurrent} disabled={isGuest || ui.status === "ready"}>
                重开本关
              </button>
            </div>
          </div>

          <aside className="tank-battle-sidebar space-y-3">
            <section className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-[0_14px_34px_rgba(15,23,42,0.08)]">
              <div>
                <div className="text-sm font-black text-slate-950">状态</div>
                <div className="mt-1 text-xs text-slate-500">{ui.message}</div>
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
                房主控制玩家一，加入者控制玩家二。联网通过本站中转。
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
              <div className="mt-2 grid grid-cols-3 gap-2">
                <button type="button" className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm font-bold text-emerald-800 disabled:opacity-50" onClick={startHost} disabled={!canUseOnline}>
                  创建房间
                </button>
                <button type="button" className="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-bold text-slate-700 disabled:opacity-50" onClick={copyRoomLink} disabled={!roomId}>
                  {copied ? "已复制" : "复制邀请"}
                </button>
                <button
                  type="button"
                  className="rounded-2xl bg-slate-950 px-3 py-3 text-sm font-bold text-white disabled:opacity-50"
                  onClick={startOnlineHostGame}
                  disabled={!isOnlineHostReady || !hasOnlinePeer}
                >
                  开始
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
            </section>
          </aside>
        </section>

        <section className="tank-battle-footer rounded-[24px] border border-slate-200 bg-white p-4 text-xs leading-6 text-slate-500 shadow-[0_14px_34px_rgba(15,23,42,0.08)]">
          已实现基地防守、砖墙/钢墙/水域/树林/冰面、敌军出生、敌军 AI、子弹碰撞、玩家生命、火力升级、护盾、清屏、暂停敌军、基地钢墙、加命、关卡循环、单人和联网双打。
        </section>
      </div>
    </main>
  );
}
