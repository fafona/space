"use client";
import { useEffect } from "react";
import type { LocationWorkspaceActivity } from "@/lib/merchantAttendanceLocationWorkspace";
export type AttendanceWorkspaceReporter = (activity: LocationWorkspaceActivity) => void;
export function useAttendanceLocationWorkspaceActivity(report: AttendanceWorkspaceReporter | undefined, phase: string, pendingId: string | null, receiptId: string | null) {
  const busy = phase === "idle" || phase === "loading" || phase === "saving" || phase === "locating" || phase === "submitting";
  useEffect(() => { report?.({ busy, pendingId, receiptId }); }, [report, busy, pendingId, receiptId]);
}
