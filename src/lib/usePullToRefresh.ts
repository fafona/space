"use client";

import { useCallback, useEffect, useRef, useState, type TouchEventHandler } from "react";

type UsePullToRefreshOptions = {
  onRefresh: () => Promise<void> | void;
  getScrollElement: () => HTMLElement | null;
  disabled?: boolean;
  threshold?: number;
  maxPull?: number;
  resistance?: number;
};

type PullStartPoint = {
  x: number;
  y: number;
};

export default function usePullToRefresh({
  onRefresh,
  getScrollElement,
  disabled = false,
  threshold = 56,
  maxPull = 104,
  resistance = 0.45,
}: UsePullToRefreshOptions) {
  const startPointRef = useRef<PullStartPoint | null>(null);
  const [pullDistance, setPullDistance] = useState(0);
  const [readyToRefresh, setReadyToRefresh] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const resetPullState = useCallback(() => {
    startPointRef.current = null;
    setPullDistance(0);
    setReadyToRefresh(false);
  }, []);

  const runRefresh = useCallback(async () => {
    setRefreshing(true);
    setPullDistance(Math.max(32, Math.min(threshold, maxPull)));
    setReadyToRefresh(false);
    try {
      await Promise.resolve(onRefresh());
    } finally {
      setRefreshing(false);
      setPullDistance(0);
    }
  }, [maxPull, onRefresh, threshold]);

  useEffect(() => {
    if (!disabled) return;
    resetPullState();
  }, [disabled, resetPullState]);

  const handleTouchStart = useCallback<TouchEventHandler<HTMLElement>>(
    (event) => {
      if (disabled || refreshing) return;
      const scrollElement = getScrollElement();
      if (!scrollElement || scrollElement.scrollTop > 0) {
        startPointRef.current = null;
        return;
      }
      const touch = event.touches[0];
      startPointRef.current = {
        x: touch.clientX,
        y: touch.clientY,
      };
    },
    [disabled, getScrollElement, refreshing],
  );

  const handleTouchMove = useCallback<TouchEventHandler<HTMLElement>>(
    (event) => {
      const startPoint = startPointRef.current;
      if (!startPoint || disabled || refreshing) return;
      const scrollElement = getScrollElement();
      if (!scrollElement || scrollElement.scrollTop > 0) {
        resetPullState();
        return;
      }
      const touch = event.touches[0];
      const deltaX = touch.clientX - startPoint.x;
      const deltaY = touch.clientY - startPoint.y;
      if (deltaY <= 0) {
        setPullDistance(0);
        setReadyToRefresh(false);
        return;
      }
      if (Math.abs(deltaX) > Math.abs(deltaY)) return;
      const nextDistance = Math.min(maxPull, deltaY * resistance);
      setPullDistance(nextDistance);
      setReadyToRefresh(nextDistance >= threshold);
      if (event.cancelable) {
        event.preventDefault();
      }
    },
    [disabled, getScrollElement, maxPull, refreshing, resetPullState, resistance, threshold],
  );

  const handleTouchEnd = useCallback<TouchEventHandler<HTMLElement>>(
    () => {
      if (!startPointRef.current) return;
      startPointRef.current = null;
      if (readyToRefresh && !disabled && !refreshing) {
        void runRefresh();
        return;
      }
      setPullDistance(0);
      setReadyToRefresh(false);
    },
    [disabled, readyToRefresh, refreshing, runRefresh],
  );

  const handleTouchCancel = useCallback<TouchEventHandler<HTMLElement>>(() => {
    resetPullState();
  }, [resetPullState]);

  return {
    pullDistance,
    readyToRefresh,
    refreshing,
    bind: {
      onTouchStart: handleTouchStart,
      onTouchMove: handleTouchMove,
      onTouchEnd: handleTouchEnd,
      onTouchCancel: handleTouchCancel,
    },
  };
}
