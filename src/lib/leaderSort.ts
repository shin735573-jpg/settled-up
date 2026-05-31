// 팀장 목록 공통 정렬: 수수료가 낮은 팀장이 항상 위.
// - region이 "metro" → fee_rate_metro
// - region이 "regional" → fee_rate_regional
// - region 미지정 → 두 값 중 0이 아닌 작은 값. 둘 다 0이면 맨 아래.
// 동률은 이름 가나다 순.

export type LeaderFeeShape = {
  name?: string | null;
  region?: string | null;
  fee_rate_metro?: number | null;
  fee_rate_regional?: number | null;
};

export function effectiveLeaderFee(l: LeaderFeeShape): number {
  const reg = (l.region || "").trim();
  const m = Number(l.fee_rate_metro ?? 0);
  const g = Number(l.fee_rate_regional ?? 0);
  if (reg === "metro") return m;
  if (reg === "regional") return g;
  // 지정된 값(0 포함) 중 사용 중인 값 선택, 둘 다 0이면 0 (최상위)
  if (m > 0 && g > 0) return Math.min(m, g);
  if (m > 0) return m;
  if (g > 0) return g;
  return 0; // 둘 다 0 → 수수료 0%로 최상위
}

export function compareLeadersByFeeAsc(a: LeaderFeeShape, b: LeaderFeeShape): number {
  const an = (a.name || "").trim();
  const bn = (b.name || "").trim();
  // 삼호 항상 최상위, 김용익 항상 최하위 — 변경 불가 고정 규칙
  const rank = (n: string): number => {
    if (n === "삼호") return -1;
    if (n === "김용익") return 1;
    return 0;
  };
  const ra = rank(an), rb = rank(bn);
  if (ra !== rb) return ra - rb;
  const af = effectiveLeaderFee(a);
  const bf = effectiveLeaderFee(b);
  if (af !== bf) return af - bf;
  return an.localeCompare(bn);
}

export function sortLeadersByFeeAsc<T extends LeaderFeeShape>(arr: T[]): T[] {
  return [...arr].sort(compareLeadersByFeeAsc);
}