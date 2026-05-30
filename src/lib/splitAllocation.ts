// 배송 1건을 각 팀장에게 분배하는 순수 함수.
// 우선순위: 형주동석 > 3분할 > 2인배송 > 일반

export type AllocInput = {
  leader1_id: string | null;
  leader2_id: string | null;
  split_type: string | null;
  two_person?: boolean | null;
  metro_fee: number;
  note_amount: number;
  regional_fee: number;
  cod_amount: number;
};

export type LeaderShare = {
  leader_id: string;
  weight: number;       // 0~1
  metro: number;
  note_amount: number;
  regional: number;
  cod: number;
  count: number;        // 1 if weight > 0 else 0
};

const n = (v: unknown) => Number(v ?? 0) || 0;

/** 행에 대한 팀장별 분배 결과 (weight + 금액 배분). */
export function allocateRow(r: AllocInput): LeaderShare[] {
  const l1 = r.leader1_id;
  const l2 = r.leader2_id;
  const split = (r.split_type || "").trim();

  let weights: [number, number] = [1, 0];
  if (split === "형주동석" && l1 && l2) {
    weights = [0.5, 0.5];
  } else if (split === "3분할" && l1 && l2) {
    weights = [2 / 3, 1 / 3];
  } else if (r.two_person && l1 && l2) {
    weights = [0.5, 0.5];
  } else if (l1 && !l2) {
    weights = [1, 0];
  } else if (l1 && l2) {
    // 일반 + 팀장2 있음 + 2인배송 아니오 → 기본은 팀장1 100%
    weights = [1, 0];
  }

  const ids: (string | null)[] = [l1, l2];
  const out: LeaderShare[] = [];
  ids.forEach((id, i) => {
    const w = weights[i];
    if (!id || w <= 0) return;
    out.push({
      leader_id: id,
      weight: w,
      metro: n(r.metro_fee) * w,
      note_amount: n(r.note_amount) * w,
      regional: n(r.regional_fee) * w,
      cod: n(r.cod_amount) * w,
      count: 1,
    });
  });
  return out;
}

/** 팀장별 건별 수수료 (비고금액은 제외). region_type을 알 수 없으면 0. */
export function feeForShare(
  share: { metro: number; regional: number },
  rates: { metro: number; regional: number },
): number {
  return Math.round(
    (share.metro * n(rates.metro) + share.regional * n(rates.regional)) / 100,
  );
}