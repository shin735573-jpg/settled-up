/**
 * 오늘 날짜 기준으로 "현재 정산 대상 기간" 자동 계산
 *  - 매월 1~15일  → 직전 달의 16~말일 (h2)
 *  - 매월 16~말일 → 이번 달의 1~15일 (h1)
 */
export type HalfKey = "h1" | "h2";

export function getCurrentHalf(today: Date = new Date()): { month: string; half: HalfKey } {
  const y = today.getFullYear();
  const m = today.getMonth();
  const d = today.getDate();
  if (d <= 15) {
    const prev = new Date(y, m - 1, 1);
    return {
      month: `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`,
      half: "h2",
    };
  }
  return { month: `${y}-${String(m + 1).padStart(2, "0")}`, half: "h1" };
}