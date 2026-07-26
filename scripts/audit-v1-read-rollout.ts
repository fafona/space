import { createReadStream } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";

import {
  DEFAULT_MERCHANT_V1_READ_ROLLOUT_POLICY,
  evaluateMerchantV1ReadRollout,
  MERCHANT_V1_READ_DOMAINS,
  parseMerchantV1ReadObservationLines,
  type MerchantV1ReadDomain,
} from "../src/lib/merchantV1ReadRolloutAudit";

export type V1ReadRolloutAuditOptions = {
  file: string;
  siteId: string;
  domains: MerchantV1ReadDomain[];
  minimumSamplesPerDomain: number;
  minimumObservationWindowHours: number;
  maximumFallbackRate: number;
  maximumP95DurationMs: number;
  maximumLastObservationAgeHours: number;
};

function parseBoundedInteger(
  value: string,
  name: string,
  minimum: number,
  maximum: number,
) {
  const parsed = Number.parseInt(value, 10);
  if (
    !Number.isFinite(parsed) ||
    String(parsed) !== value ||
    parsed < minimum ||
    parsed > maximum
  ) {
    throw new Error(`${name}_must_be_between_${minimum}_and_${maximum}`);
  }
  return parsed;
}

function parseBoundedRate(value: string) {
  if (!/^(?:0(?:\.\d+)?|1(?:\.0+)?)$/.test(value)) {
    throw new Error("max_fallback_rate_must_be_between_0_and_1");
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error("max_fallback_rate_must_be_between_0_and_1");
  }
  return parsed;
}

function parseDomains(value: string): MerchantV1ReadDomain[] {
  const domains = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (
    domains.length === 0 ||
    new Set(domains).size !== domains.length ||
    domains.some(
      (domain) =>
        !MERCHANT_V1_READ_DOMAINS.includes(domain as MerchantV1ReadDomain),
    )
  ) {
    throw new Error("domains_must_be_unique_known_values");
  }
  return domains as MerchantV1ReadDomain[];
}

export function parseV1ReadRolloutAuditOptions(
  args: string[],
): V1ReadRolloutAuditOptions {
  const options: Partial<V1ReadRolloutAuditOptions> = {
    domains: [...DEFAULT_MERCHANT_V1_READ_ROLLOUT_POLICY.domains],
    minimumSamplesPerDomain:
      DEFAULT_MERCHANT_V1_READ_ROLLOUT_POLICY.minimumSamplesPerDomain,
    minimumObservationWindowHours:
      DEFAULT_MERCHANT_V1_READ_ROLLOUT_POLICY.minimumObservationWindowHours,
    maximumFallbackRate:
      DEFAULT_MERCHANT_V1_READ_ROLLOUT_POLICY.maximumFallbackRate,
    maximumP95DurationMs:
      DEFAULT_MERCHANT_V1_READ_ROLLOUT_POLICY.maximumP95DurationMs,
    maximumLastObservationAgeHours:
      DEFAULT_MERCHANT_V1_READ_ROLLOUT_POLICY.maximumLastObservationAgeHours,
  };
  const seen = new Set<string>();

  for (const arg of args) {
    const separator = arg.indexOf("=");
    if (!arg.startsWith("--") || separator < 3) {
      throw new Error(`unknown_argument:${arg}`);
    }
    const name = arg.slice(2, separator);
    const value = arg.slice(separator + 1).trim();
    if (!value) throw new Error(`empty_argument:${name}`);
    if (seen.has(name)) throw new Error(`duplicate_argument:${name}`);
    seen.add(name);

    if (name === "file") {
      options.file = value;
    } else if (name === "site") {
      if (!/^\d{8}$/.test(value)) throw new Error("site_must_be_exact_8_digit_id");
      options.siteId = value;
    } else if (name === "domains") {
      options.domains = parseDomains(value);
    } else if (name === "min-samples") {
      options.minimumSamplesPerDomain = parseBoundedInteger(
        value,
        "min_samples",
        1,
        1_000_000,
      );
    } else if (name === "min-window-hours") {
      options.minimumObservationWindowHours = parseBoundedInteger(
        value,
        "min_window_hours",
        1,
        2160,
      );
    } else if (name === "max-fallback-rate") {
      options.maximumFallbackRate = parseBoundedRate(value);
    } else if (name === "max-p95-ms") {
      options.maximumP95DurationMs = parseBoundedInteger(
        value,
        "max_p95_ms",
        1,
        600_000,
      );
    } else if (name === "max-last-age-hours") {
      options.maximumLastObservationAgeHours = parseBoundedInteger(
        value,
        "max_last_age_hours",
        1,
        720,
      );
    } else {
      throw new Error(`unknown_argument:${name}`);
    }
  }

  if (!options.file) throw new Error("file_is_required");
  if (!options.siteId) throw new Error("site_is_required");
  return options as V1ReadRolloutAuditOptions;
}

async function loadObservationLines(file: string) {
  const stream =
    file === "-"
      ? process.stdin
      : createReadStream(resolve(process.cwd(), file), { encoding: "utf8" });
  const reader = createInterface({ input: stream, crlfDelay: Infinity });
  const lines: string[] = [];
  for await (const line of reader) lines.push(line);
  return lines;
}

function formatNumber(value: number | null, fractionDigits = 1) {
  return value === null ? "-" : value.toFixed(fractionDigits);
}

async function main() {
  const options = parseV1ReadRolloutAuditOptions(process.argv.slice(2));
  const lines = await loadObservationLines(options.file);
  const parsed = parseMerchantV1ReadObservationLines(lines);
  const report = evaluateMerchantV1ReadRollout({
    siteId: options.siteId,
    parsed,
    policy: {
      domains: options.domains,
      minimumSamplesPerDomain: options.minimumSamplesPerDomain,
      minimumObservationWindowHours: options.minimumObservationWindowHours,
      maximumFallbackRate: options.maximumFallbackRate,
      maximumP95DurationMs: options.maximumP95DurationMs,
      maximumLastObservationAgeHours: options.maximumLastObservationAgeHours,
    },
  });

  console.log(
    `[v1-read-rollout-audit] site=${report.siteId} status=${report.status} rejected=${report.rejectedLineCount} ignored=${report.ignoredLineCount}`,
  );
  report.blockers.forEach((blocker) => {
    console.error(`[v1-read-rollout-audit] blocker=${blocker}`);
  });
  report.domains.forEach((domain) => {
    console.log(
      `[v1-read-rollout-audit] domain=${domain.domain} status=${domain.status} samples=${domain.sampleCount} matches=${domain.matchCount} fallbacks=${domain.fallbackCount} fallback-rate=${(domain.fallbackRate * 100).toFixed(3)}% window-hours=${formatNumber(domain.observationWindowHours)} last-age-hours=${formatNumber(domain.latestObservationAgeHours)} p50-ms=${formatNumber(domain.p50DurationMs, 0)} p95-ms=${formatNumber(domain.p95DurationMs, 0)} p99-ms=${formatNumber(domain.p99DurationMs, 0)}`,
    );
    domain.blockers.forEach((blocker) => {
      console.error(
        `[v1-read-rollout-audit] domain=${domain.domain} blocker=${blocker}`,
      );
    });
  });
  if (report.status === "blocked") process.exitCode = 2;
}

const invokedFile = process.argv[1]?.replaceAll("\\", "/") ?? "";
if (invokedFile.endsWith("/audit-v1-read-rollout.ts")) {
  main().catch((error) => {
    console.error(
      `[v1-read-rollout-audit] failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exitCode = 1;
  });
}
