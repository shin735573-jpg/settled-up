// 배송 1건을 각 팀장에게 분배하는 순수 함수.
// 우선순위: 형주동석 > 3분할 > 2인배송 > 일반
// 그 후 강형주/신동석 팀 재분배: 두 사람은 한 팀이므로 누구의 몫이든 강형주 50% / 신동석 50%로 다시 나눔.
// 단, "형주동석" 분할로 강형주+신동석이 직접 50/50으로 배정된 경우에만 재분배를 건너뜀.

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

const distributeWon = (amount: unknown, weights: number[]): number[] => {
  const total = Math.round(n(amount));
  if (total === 0) return weights.map(() => 0);
  const raw = weights.map((w) => total * w);
  const base = raw.map((v) => Math.floor(v));
  let remainder = total - base.reduce((s, v) => s + v, 0);
  const order = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let p = 0; p < order.length && remainder > 0; p += 1, remainder -= 1) {
    base[order[p].i] += 1;
  }
  return base;
};

export type ShindongseokOptions = {
  shindongseokId?: string | null;
  ganghyungjuId?: string | null;
  /** 오은규 단독 배송(오동선·김용익이 함께 없는 경우)을 오동선으로 합산 정산 */
  oeunkyuId?: string | null;
  odongseonId?: string | null;
  kimyongikId?: string | null;
};

/** 행에 대한 팀장별 분배 결과 (weight + 금액 배분). */
export function allocateRow(r: AllocInput, opts: ShindongseokOptions = {}): LeaderShare[] {
  const l1 = r.leader1_id;
  const l2 = r.leader2_id;
  const l3 = r.leader3_id ?? null;
  const split = (r.split_type || "").trim();

  let weights: number[] = [1, 0, 0];
  let reasons: string[] = ["일반 100%", "", ""];
  // 우선순위: 형주동석 > 3분할 > 3인배송 > 2인배송 > 일반
  if (split === "형주동석" && l1 && l2) {
    weights = [0.5, 0.5];
    reasons = ["형주동석 50%", "형주동석 50%"];
  } else if (split === "3분할" && l1 && l2) {
    weights = [2 / 3, 1 / 3];
    reasons = ["3분할 2/3", "3분할 1/3"];
  } else if (l1 && l2 && l3) {
    // 3인배송: 1/3씩 균등 분배
    weights = [1 / 3, 1 / 3, 1 / 3];
    reasons = ["3인배송 1/3", "3인배송 1/3", "3인배송 1/3"];
  } else if (r.two_person && l1 && l2) {
    weights = [0.5, 0.5];
    reasons = ["2인배송 50%", "2인배송 50%"];
  } else if (l1 && !l2) {
    weights = [1, 0];
    reasons = ["일반 100%", ""];
  } else if (l1 && l2) {
    // 일반 + 팀장1·2 모두 입력 → 자동 50/50 분배 (함께 배송한 것으로 간주)
    weights = [0.5, 0.5];
    reasons = ["함께배송 50%", "함께배송 50%"];
  }

  const ids: (string | null)[] = [l1, l2, l3];
  const metroParts = distributeWon(r.metro_fee, weights);
  const noteParts = distributeWon(r.note_amount, weights);
  const regionalParts = distributeWon(r.regional_fee, weights);
  const codParts = distributeWon(r.cod_amount, weights);
  const initial: LeaderShare[] = [];
  ids.forEach((id, i) => {
    const w = weights[i] ?? 0;
    if (!id || w <= 0) return;
    initial.push({
      leader_id: id,
      weight: w,
      metro: metroParts[i] ?? 0,
      note_amount: noteParts[i] ?? 0,
      regional: regionalParts[i] ?? 0,
      cod: codParts[i] ?? 0,
      count: 1,
      reason: reasons[i] ?? "",
    });
  });

  // 강형주/신동석 팀 재분배 — 두 사람은 한 팀.
  // 누구의 몫이든 강형주 50% / 신동석 50%로 다시 나눔.
  // 단, 형주동석 분할로 강형주+신동석이 직접 50:50으로 배정된 경우에만 건너뜀.
  // (형주동석 split이지만 한 명만 입력된 행은 정상 재분배해야 두 사람 건수/금액이 같아짐.)
  const { shindongseokId, ganghyungjuId } = opts;
  const skipTeamRedist =
    !shindongseokId || !ganghyungjuId ||
    (split === "형주동석" && !!l1 && !!l2 &&
      new Set([l1, l2]).has(shindongseokId) &&
      new Set([l1, l2]).has(ganghyungjuId));
  const teamIds = new Set(
    [shindongseokId, ganghyungjuId].filter(Boolean) as string[],
  );
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
    if (skipTeamRedist || !teamIds.has(s.leader_id)) { add(s); return; }
    const [metroA, metroB] = distributeWon(s.metro, [0.5, 0.5]);
    const [noteA, noteB] = distributeWon(s.note_amount, [0.5, 0.5]);
    const [regionalA, regionalB] = distributeWon(s.regional, [0.5, 0.5]);
    const [codA, codB] = distributeWon(s.cod, [0.5, 0.5]);
    const pct = Math.round(s.weight * 50);
    const who = s.leader_id === shindongseokId ? "신동석" : "강형주";
    const reason = `${who} 몫 재분배 ${pct}%`;
    add({
      leader_id: ganghyungjuId as string,
      weight: s.weight / 2,
      metro: metroA, note_amount: noteA,
      regional: regionalA, cod: codA,
      count: 1,
      reason,
    });
    add({
      leader_id: shindongseokId as string,
      weight: s.weight / 2,
      metro: metroB, note_amount: noteB,
      regional: regionalB, cod: codB,
      count: 1,
      reason,
    });
  });
  const afterTeam = Array.from(merged.values());

  // 오은규 → 오동선 합산 정산: 오은규 몫은 항상 오동선 정산서로 합산.
  // (오동선+김용익 50/50 유지, 오동선+오은규+김용익이면 오동선 2/3·김용익 1/3 효과)
  const { oeunkyuId, odongseonId } = opts;
  if (!oeunkyuId || !odongseonId) return afterTeam;
  const oeunkyuShare = afterTeam.find((s) => s.leader_id === oeunkyuId);
  if (!oeunkyuShare) return afterTeam;
  const others = afterTeam.filter((s) => s.leader_id !== oeunkyuId);
  const existing = others.find((s) => s.leader_id === odongseonId);
  const reason = "오은규 → 오동선 합산 정산";
  if (existing) {
    existing.weight += oeunkyuShare.weight;
    existing.metro += oeunkyuShare.metro;
    existing.note_amount += oeunkyuShare.note_amount;
    existing.regional += oeunkyuShare.regional;
    existing.cod += oeunkyuShare.cod;
    existing.count = 1;
    existing.reason = reason;
  } else {
    others.push({
      leader_id: odongseonId,
      weight: oeunkyuShare.weight,
      metro: oeunkyuShare.metro,
      note_amount: oeunkyuShare.note_amount,
      regional: oeunkyuShare.regional,
      cod: oeunkyuShare.cod,
      count: 1,
      reason,
    });
  }
  return others;
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