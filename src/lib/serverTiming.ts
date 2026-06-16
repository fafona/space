type ServerTimingMetric = {
  name: string;
  durationMs: number;
  description?: string;
};

function readNowMs() {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function normalizeMetricName(value: string) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "step";
}

function escapeDescription(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function formatDuration(value: number) {
  return Math.max(0, value).toFixed(1);
}

export function createServerTiming() {
  const startedAt = readNowMs();
  const metrics: ServerTimingMetric[] = [];

  const add = (name: string, durationMs: number, description?: string) => {
    metrics.push({
      name: normalizeMetricName(name),
      durationMs,
      description: description ? String(description).slice(0, 80) : undefined,
    });
  };

  return {
    add,
    async time<T>(name: string, task: () => Promise<T>, description?: string) {
      const stepStartedAt = readNowMs();
      try {
        return await task();
      } finally {
        add(name, readNowMs() - stepStartedAt, description);
      }
    },
    mark(name: string, stepStartedAt: number, description?: string) {
      add(name, readNowMs() - stepStartedAt, description);
    },
    now() {
      return readNowMs();
    },
    toHeader() {
      const totalDurationMs = readNowMs() - startedAt;
      const allMetrics = [...metrics, { name: "total", durationMs: totalDurationMs }];
      return allMetrics
        .map((metric) => {
          const base = `${metric.name};dur=${formatDuration(metric.durationMs)}`;
          return metric.description ? `${base};desc="${escapeDescription(metric.description)}"` : base;
        })
        .join(", ");
    },
    apply(headers: Headers) {
      headers.set("server-timing", this.toHeader());
    },
  };
}

export type ServerTiming = ReturnType<typeof createServerTiming>;
