import { useState, useRef, useCallback } from 'react';

const THRESHOLD = 70;   // px the user must drag before a refresh triggers
const MAX_PULL = 110;   // px cap used to normalise pull progress (0..1)

export function usePullToRefresh(onRefresh) {
  const [isPulling, setIsPulling] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const startY = useRef(0);
  const triggered = useRef(false);

  const onTouchStart = useCallback((e) => {
    if (window.scrollY === 0) {
      startY.current = e.touches[0].clientY;
      triggered.current = false;
    }
  }, []);

  const onTouchMove = useCallback((e) => {
    if (window.scrollY > 0 || isRefreshing) return;
    const delta = e.touches[0].clientY - startY.current;
    if (delta > 0) {
      const dist = Math.min(delta, MAX_PULL);
      setPullDistance(dist);
      setIsPulling(dist > 6);
    } else {
      setPullDistance(0);
      setIsPulling(false);
    }
  }, [isRefreshing]);

  const onTouchEnd = useCallback(async () => {
    const shouldRefresh = pullDistance >= THRESHOLD && !isRefreshing;
    setIsPulling(false);
    setPullDistance(0);
    if (shouldRefresh) {
      triggered.current = true;
      setIsRefreshing(true);
      try {
        await onRefresh();
      } finally {
        setIsRefreshing(false);
      }
    }
  }, [pullDistance, isRefreshing, onRefresh]);

  // pullProgress: 0..1 toward the trigger threshold (used to fill the spinner arc)
  const pullProgress = Math.min(1, pullDistance / THRESHOLD);

  return { isPulling, isRefreshing, pullProgress, pullDistance, onTouchStart, onTouchMove, onTouchEnd };
}