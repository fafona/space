"use client";

import { useReportWebVitals } from "next/web-vitals";
import { reportWebVitalPerformance } from "@/lib/performanceTelemetry";

function reportWebVitals(metric: {
  name: string;
  value: number;
  rating?: string;
  navigationType?: string;
}) {
  reportWebVitalPerformance(metric);
}

export default function PerformanceTelemetry() {
  useReportWebVitals(reportWebVitals);
  return null;
}
