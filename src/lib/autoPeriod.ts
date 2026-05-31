import { useEffect, useRef } from "react";

/**
 * 오늘 날짜 기준으로 "현재 정산 대상 기간" 자동 계산
 *  - 매월 1~15일  → 이번 달 1~15일  (h1)
 *  - 매월 16~말일 → 이번 달 16~말일 (h2)
 *  즉, 오늘이 속한 반기를 그대로 반환한다.
 */
export type HalfKey = "h1" | "h2";

export function getCurrentHalf(today: Date = new Date()): { month: string; half: HalfKey } {
  const y = today.getFullYear();
  const m = today.getMonth();
  const d = today.getDate();
  const month = `${y}-${String(m + 1).padStart(2, "0")}`;
  return { month, half: d <= 15 ? "h1" : "h2" };
}

/**
 * 다음 "경계 시점"(자정 또는 16일 자정)까지 남은 ms.
 * 항상 다음 자정 + 안전 여유 1초.
 */
function msUntilNextMidnight(now: Date = new Date()): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1, 0);
  return Math.max(1000, next.getTime() - now.getTime());
}

/**
 * 자동 기간 동기화 훅.
 *  - 마운트 시 즉시 sync
 *  - 다음 자정 + 1초 시점에 정확히 재계산 (자정 경계 누락 방지)
 *  - focus / visibilitychange(visible) / pageshow(bfcache) / online 이벤트에서 재동기화
 *  - 안전망: 5분 간격 폴백 (시스템 슬립·시계 변경 대응)
 * enabled=false 면 아무 것도 하지 않음.
 */
export function useAutoPeriodSync(enabled: boolean, onSync: () => void) {
  const cbRef = useRef(onSync);
  cbRef.current = onSync;

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let midnightTimer: number | undefined;

    const run = () => { if (!stopped) cbRef.current(); };

    const scheduleMidnight = () => {
      if (stopped) return;
      if (midnightTimer !== undefined) window.clearTimeout(midnightTimer);
      midnightTimer = window.setTimeout(() => {
        run();
        scheduleMidnight(); // 다음 자정 재예약
      }, msUntilNextMidnight());
    };

    const onFocus = () => run();
    const onVis = () => {
      if (document.visibilityState === "visible") {
        run();
        scheduleMidnight(); // 슬립 등으로 타이머가 밀렸을 수 있어 재예약
      }
    };
    const onPageShow = () => { run(); scheduleMidnight(); };
    const onOnline = () => run();

    // 초기 1회 즉시 동기화
    run();
    scheduleMidnight();
    const fallback = window.setInterval(run, 5 * 60 * 1000);

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("online", onOnline);

    return () => {
      stopped = true;
      if (midnightTimer !== undefined) window.clearTimeout(midnightTimer);
      window.clearInterval(fallback);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("online", onOnline);
    };
  }, [enabled]);
}