export type MerchantOrderV1ReadCircuitBreakerConfig = {
  enabled: boolean;
  failureThreshold: number;
  failureWindowMs: number;
  cooldownMs: number;
};

export type MerchantOrderV1ReadCircuitPermit = {
  allowed: boolean;
  phase: "disabled" | "closed" | "open" | "half_open";
  generation: number;
  retryAtMs: number | null;
};

type MerchantOrderV1ReadCircuitState = {
  failureTimestamps: number[];
  openUntilMs: number;
  probeInFlight: boolean;
  generation: number;
};

export const DEFAULT_MERCHANT_ORDER_V1_READ_CIRCUIT_BREAKER_CONFIG: MerchantOrderV1ReadCircuitBreakerConfig =
  {
    enabled: false,
    failureThreshold: 3,
    failureWindowMs: 60_000,
    cooldownMs: 300_000,
  };

const MIN_FAILURE_THRESHOLD = 2;
const MAX_FAILURE_THRESHOLD = 20;
const MIN_FAILURE_WINDOW_MS = 10_000;
const MAX_FAILURE_WINDOW_MS = 3_600_000;
const MIN_COOLDOWN_MS = 30_000;
const MAX_COOLDOWN_MS = 3_600_000;
const SITE_ID_PATTERN = /^\d{8}$/;

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const parsed =
    typeof value === "number" ? value : Number.parseInt(trimText(value), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(parsed)));
}

function normalizeNowMs(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : Date.now();
}

function normalizeRuntimeConfig(
  config: MerchantOrderV1ReadCircuitBreakerConfig,
): MerchantOrderV1ReadCircuitBreakerConfig {
  return {
    enabled: config.enabled === true,
    failureThreshold: normalizeInteger(
      config.failureThreshold,
      DEFAULT_MERCHANT_ORDER_V1_READ_CIRCUIT_BREAKER_CONFIG.failureThreshold,
      MIN_FAILURE_THRESHOLD,
      MAX_FAILURE_THRESHOLD,
    ),
    failureWindowMs: normalizeInteger(
      config.failureWindowMs,
      DEFAULT_MERCHANT_ORDER_V1_READ_CIRCUIT_BREAKER_CONFIG.failureWindowMs,
      MIN_FAILURE_WINDOW_MS,
      MAX_FAILURE_WINDOW_MS,
    ),
    cooldownMs: normalizeInteger(
      config.cooldownMs,
      DEFAULT_MERCHANT_ORDER_V1_READ_CIRCUIT_BREAKER_CONFIG.cooldownMs,
      MIN_COOLDOWN_MS,
      MAX_COOLDOWN_MS,
    ),
  };
}

function disabledPermit(): MerchantOrderV1ReadCircuitPermit {
  return {
    allowed: true,
    phase: "disabled",
    generation: -1,
    retryAtMs: null,
  };
}

export function resolveMerchantOrderV1ReadCircuitBreakerConfig(
  environment: Record<string, string | undefined> = process.env,
): MerchantOrderV1ReadCircuitBreakerConfig {
  return {
    enabled:
      trimText(environment.MERCHANT_ORDER_V1_PRIMARY_CIRCUIT_BREAKER_ENABLED).toLowerCase() ===
      "true",
    failureThreshold: normalizeInteger(
      environment.MERCHANT_ORDER_V1_PRIMARY_CIRCUIT_BREAKER_FAILURE_THRESHOLD,
      DEFAULT_MERCHANT_ORDER_V1_READ_CIRCUIT_BREAKER_CONFIG.failureThreshold,
      MIN_FAILURE_THRESHOLD,
      MAX_FAILURE_THRESHOLD,
    ),
    failureWindowMs: normalizeInteger(
      environment.MERCHANT_ORDER_V1_PRIMARY_CIRCUIT_BREAKER_WINDOW_MS,
      DEFAULT_MERCHANT_ORDER_V1_READ_CIRCUIT_BREAKER_CONFIG.failureWindowMs,
      MIN_FAILURE_WINDOW_MS,
      MAX_FAILURE_WINDOW_MS,
    ),
    cooldownMs: normalizeInteger(
      environment.MERCHANT_ORDER_V1_PRIMARY_CIRCUIT_BREAKER_COOLDOWN_MS,
      DEFAULT_MERCHANT_ORDER_V1_READ_CIRCUIT_BREAKER_CONFIG.cooldownMs,
      MIN_COOLDOWN_MS,
      MAX_COOLDOWN_MS,
    ),
  };
}

export class MerchantOrderV1ReadCircuitBreaker {
  private readonly states = new Map<string, MerchantOrderV1ReadCircuitState>();

  acquire(
    siteId: string,
    inputConfig: MerchantOrderV1ReadCircuitBreakerConfig,
    inputNowMs = Date.now(),
  ): MerchantOrderV1ReadCircuitPermit {
    const config = normalizeRuntimeConfig(inputConfig);
    const normalizedSiteId = trimText(siteId);
    if (!config.enabled || !SITE_ID_PATTERN.test(normalizedSiteId)) {
      return disabledPermit();
    }

    const nowMs = normalizeNowMs(inputNowMs);
    const state = this.getOrCreateState(normalizedSiteId);
    if (state.openUntilMs > nowMs) {
      return {
        allowed: false,
        phase: "open",
        generation: state.generation,
        retryAtMs: state.openUntilMs,
      };
    }

    if (state.openUntilMs > 0) {
      if (state.probeInFlight) {
        return {
          allowed: false,
          phase: "half_open",
          generation: state.generation,
          retryAtMs: null,
        };
      }
      state.probeInFlight = true;
      return {
        allowed: true,
        phase: "half_open",
        generation: state.generation,
        retryAtMs: null,
      };
    }

    return {
      allowed: true,
      phase: "closed",
      generation: state.generation,
      retryAtMs: null,
    };
  }

  recordSuccess(
    siteId: string,
    inputConfig: MerchantOrderV1ReadCircuitBreakerConfig,
    permit: MerchantOrderV1ReadCircuitPermit,
  ) {
    const config = normalizeRuntimeConfig(inputConfig);
    const normalizedSiteId = trimText(siteId);
    if (!config.enabled || !permit.allowed || permit.phase === "disabled") return;

    const state = this.states.get(normalizedSiteId);
    if (!state || state.generation !== permit.generation) return;
    state.failureTimestamps = [];
    state.openUntilMs = 0;
    state.probeInFlight = false;
    state.generation += 1;
  }

  recordFailure(
    siteId: string,
    inputConfig: MerchantOrderV1ReadCircuitBreakerConfig,
    permit: MerchantOrderV1ReadCircuitPermit,
    inputNowMs = Date.now(),
  ) {
    const config = normalizeRuntimeConfig(inputConfig);
    const normalizedSiteId = trimText(siteId);
    if (!config.enabled || !permit.allowed || permit.phase === "disabled") return;

    const state = this.states.get(normalizedSiteId);
    if (!state || state.generation !== permit.generation) return;
    const nowMs = normalizeNowMs(inputNowMs);

    if (permit.phase === "half_open") {
      this.open(state, config, nowMs);
      return;
    }

    const windowStartedAt = nowMs - config.failureWindowMs;
    state.failureTimestamps = state.failureTimestamps.filter(
      (timestamp) => timestamp >= windowStartedAt && timestamp <= nowMs,
    );
    state.failureTimestamps.push(nowMs);
    if (state.failureTimestamps.length >= config.failureThreshold) {
      this.open(state, config, nowMs);
    }
  }

  recordInconclusive(
    siteId: string,
    inputConfig: MerchantOrderV1ReadCircuitBreakerConfig,
    permit: MerchantOrderV1ReadCircuitPermit,
    inputNowMs = Date.now(),
  ) {
    if (permit.phase !== "half_open") return;
    this.recordFailure(siteId, inputConfig, permit, inputNowMs);
  }

  reset(siteId?: string) {
    const normalizedSiteId = trimText(siteId);
    if (normalizedSiteId) {
      this.states.delete(normalizedSiteId);
      return;
    }
    this.states.clear();
  }

  private getOrCreateState(siteId: string) {
    const existing = this.states.get(siteId);
    if (existing) return existing;
    const state: MerchantOrderV1ReadCircuitState = {
      failureTimestamps: [],
      openUntilMs: 0,
      probeInFlight: false,
      generation: 0,
    };
    this.states.set(siteId, state);
    return state;
  }

  private open(
    state: MerchantOrderV1ReadCircuitState,
    config: MerchantOrderV1ReadCircuitBreakerConfig,
    nowMs: number,
  ) {
    state.failureTimestamps = [];
    state.openUntilMs = nowMs + config.cooldownMs;
    state.probeInFlight = false;
    state.generation += 1;
  }
}

export const merchantOrderV1ReadCircuitBreaker = new MerchantOrderV1ReadCircuitBreaker();
