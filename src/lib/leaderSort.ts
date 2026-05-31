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
  const m = Number(l.fee_rate_metro || 0);
  const g = Number(l.fee_rate_regional || 0);
  if (reg === "metro") return m;
  if (reg === "regional") return g;
  const nonzero = [m, g].filter((v) => v > 0);
  if (nonzero.length === 0) return Number.POSITIVE_INFINITY;
  return Math.min(...nonzero);
}

export function compareLeadersByFeeAsc(a: LeaderFeeShape, b: LeaderFeeShape): number {
  const af = effectiveLeaderFee(a);
  const bf = effectiveLeaderFee(b);
  if (af !== bf) return af - bf;
  return (a.name || "").localeCompare(b.name || "");
}

export function sortLeadersByFeeAsc<T extends LeaderFeeShape>(arr: T[]): T[] {
  return [...arr].sort(compareLeadersByFeeAsc);
}