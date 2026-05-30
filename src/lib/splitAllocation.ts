// 배송 1건을 각 팀장에게 분배하는 순수 함수.
// 우선순위: 형주동석 > 3분할 > 2인배송 > 일반
// 그 후 신동석 재분배: 신동석에게 배분된 몫은 강형주 50%, 신동석 50%로 다시 나눔.

export type AllocInput = {
  leader1_id: string | null;
  leader2_id: string | null;
  leader3_id?: string | null;
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
  /** 분배 사유 — 표시용 (예: "일반 100%", "2인배송 50%", "신동석 몫 재분배 25%") */
  reason?: string;
};

const n = (v: unknown) => Number(v ?? 0) || 0;

export type ShindongseokOptions = {
  shindongseokId?: string | null;
  ganghyungjuId?: string | null;
};

/** 행에 대한 팀장별 분배 결과 (weight + 금액 배분). */
export function allocateRow(r: AllocInput, opts: ShindongseokOptions = {}): LeaderShare[] {
  const l1 = r.leader1_id;
  const l2 = r.leader2_id;
  const l3 = r.leader3_id ?? null;
  const split = (r.split_type || "").trim();

  let weights: number[] = [1, 0, 0];
  let reasons: string[] = ["일반 100%", "", ""];
  if (l1 && l2 && l3) {
    // 3인배송: 1/3씩 균등 분배
    weights = [1 / 3, 1 / 3, 1 / 3];
    reasons = ["3인배송 1/3", "3인배송 1/3", "3인배송 1/3"];
  } else if (split === "형주동석" && l1 && l2) {
    weights = [0.5, 0.5];
    reasons = ["형주동석 50%", "형주동석 50%"];
  } else if (split === "3분할" && l1 && l2) {
    weights = [2 / 3, 1 / 3];
    reasons = ["3분할 2/3", "3분할 1/3"];
  } else if (r.two_person && l1 && l2) {
    weights = [0.5, 0.5];
    reasons = ["2인배송 50%", "2인배송 50%"];
  } else if (l1 && !l2) {
    weights = [1, 0];
    reasons = ["일반 100%", ""];
  } else if (l1 && l2) {
    // 일반 + 팀장2 있음 + 2인배송 아니오 → 기본은 팀장1 100%
    weights = [1, 0];
    reasons = ["일반 100%", ""];
  }

  const ids: (string | null)[] = [l1, l2, l3];
  const initial: LeaderShare[] = [];
  ids.forEach((id, i) => {
    const w = weights[i] ?? 0;
    if (!id || w <= 0) return;
    initial.push({
      leader_id: id,
      weight: w,
      metro: n(r.metro_fee) * w,
      note_amount: n(r.note_amount) * w,
      regional: n(r.regional_fee) * w,
      cod: n(r.cod_amount) * w,
      count: 1,
      reason: reasons[i] ?? "",
    });
  });

  // 강형주/신동석 팀 재분배 — 두 사람은 한 팀.
  // 누구의 몫이든 강형주 50% / 신동석 50%로 다시 나눔.
  // 단, 형주동석 분할일 때는 이미 직접 배정되어 있으므로 건너뜀.
  const { shindongseokId, ganghyungjuId } = opts;
  if (!shindongseokId || !ganghyungjuId || split === "형주동석") return initial;

  const teamIds = new Set([shindongseokId, ganghyungjuId]);
  const merged = new Map<string, LeaderShare>();
  const add = (s: LeaderShare) => {
    const cur = merged.get(s.leader_id);
    if (!cur) { merged.set(s.leader_id, { ...s }); return; }
    cur.weight += s.weight;
    cur.metro += s.metro;
    cur.note_amount += s.note_amount;
    cur.regional += s.regional;
    cur.cod += s.cod;
    cur.count = 1;
    // 사유는 가장 구체적인 재분배 사유 우선
    if (s.reason && (!cur.reason || s.reason.includes("재분배"))) cur.reason = s.reason;
  };

  initial.forEach((s) => {
    if (!teamIds.has(s.leader_id)) { add(s); return; }
    const half = (k: number) => k / 2;
    const pct = Math.round(s.weight * 50);
    const who = s.leader_id === shindongseokId ? "신동석" : "강형주";
    const reason = `${who} 몫 재분배 ${pct}%`;
    add({
      leader_id: ganghyungjuId,
      weight: s.weight / 2,
      metro: half(s.metro), note_amount: half(s.note_amount),
      regional: half(s.regional), cod: half(s.cod),
      count: 1,
      reason,
    });
    add({
      leader_id: shindongseokId,
      weight: s.weight / 2,
      metro: half(s.metro), note_amount: half(s.note_amount),
      regional: half(s.regional), cod: half(s.cod),
      count: 1,
      reason,
    });
  });
  return Array.from(merged.values());
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