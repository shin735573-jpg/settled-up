/**
 * 재방문 그룹 분배(redistribution) 공통 헬퍼.
 *
 * 규칙
 * - 업체 청구 = 1차 행 금액(baseTotal) 그대로 (이 모듈 밖에서 처리)
 * - 팀장 정산 = 1차 팀장 + 2차 팀장 합이 baseTotal 과 일치하도록 차감
 * - 2차(이후) 행에 입력된 metro+note+regional 금액 = 해당 행 팀장1에게 지급
 * - 1차 팀장1 = baseTotal − 2차 분배 합
 * - 비고/착불은 1차 팀장1 고정 (중복 청구 방지)
 * - 수기분배(`revisit_manual_shares`)가 있으면 자동 규칙보다 우선 적용
 *
 * 반환 Map 의미:
 * - 키 없음   = 재방문 그룹과 무관 (호출부에서 raw 사용)
 * - 빈 배열   = 2차+ 행 → 정산 제외
 * - 채워진 배열 = 1차 행 → 그룹 전체 분배 결과
 */

export type RevisitShare = {
  leader_id: string;
  metro: number;
  note_amount: number;
  regional: number;
  cod: number;
  reason: string;
};

export type RevisitRowLike = {
  id: string;
  leader1_id?: string | null;
  metro_fee?: number | null;
  regional_fee?: number | null;
  note_amount?: number | null;
  cod_amount?: number | null;
  revisit_group_id?: string | null;
  revisit_visit_no?: number | null;
  revisit_manual_shares?: Array<{ leader_id?: string; amount?: number }> | null;
};

const n = (v: unknown): number => Number(v ?? 0) || 0;

export function computeRevisitRedistribution<T extends RevisitRowLike>(
  rows: T[],
  virtualIds: Set<string> = new Set(),
): Map<string, RevisitShare[]> {
  const out = new Map<string, RevisitShare[]>();
  const groups = new Map<string, T[]>();
  for (const r of rows) {
    const gid = r.revisit_group_id;
    if (!gid) continue;
    const arr = groups.get(gid) || [];
    arr.push(r);
    groups.set(gid, arr);
  }
  for (const [, group] of groups) {
    const sorted = [...group].sort(
      (a, b) => Number(a.revisit_visit_no ?? 1) - Number(b.revisit_visit_no ?? 1),
    );
    const first = sorted[0];
    if (!first) continue;
    const baseMetro = n(first.metro_fee);
    const baseRegional = n(first.regional_fee);
    const baseNote = n(first.note_amount);
    const baseCod = n(first.cod_amount);
    const useMetro = baseMetro >= baseRegional;
    const baseTotal = baseMetro + baseRegional;
    const firstLeader = first.leader1_id || null;
    const firstLeaderValid = !!firstLeader && !virtualIds.has(firstLeader);

    // 2차+ 행은 항상 정산 제외
    for (let i = 1; i < sorted.length; i++) out.set(sorted[i].id, []);

    const manualRaw = Array.isArray(first.revisit_manual_shares)
      ? first.revisit_manual_shares
      : null;
    const manual = manualRaw
      ? manualRaw.filter(
          (m) => !!m && !!m.leader_id && !virtualIds.has(m.leader_id) && n(m.amount) > 0,
        )
      : null;

    if (manual && manual.length > 0) {
      const shares: RevisitShare[] = manual.map((m) => ({
        leader_id: m.leader_id as string,
        metro: useMetro ? n(m.amount) : 0,
        note_amount: 0,
        regional: useMetro ? 0 : n(m.amount),
        cod: 0,
        reason: "재방문 수기분배",
      }));
      if (firstLeaderValid && (baseNote !== 0 || baseCod !== 0)) {
        shares.push({
          leader_id: firstLeader as string,
          metro: 0,
          note_amount: baseNote,
          regional: 0,
          cod: baseCod,
          reason: "재방문 비고/착불(1차 팀장1)",
        });
      }
      out.set(first.id, shares);
      continue;
    }

    if (!firstLeaderValid) {
      out.set(first.id, []);
      continue;
    }

    // 자동 분배
    let assignedToSecondary = 0;
    const shares: RevisitShare[] = [];
    for (let i = 1; i < sorted.length; i++) {
      const sec = sorted[i];
      const secLeader = sec.leader1_id;
      if (!secLeader || virtualIds.has(secLeader)) continue;
      if (secLeader === firstLeader) continue; // 동일 팀장 → 차감 없음
      const secAmt = n(sec.metro_fee) + n(sec.note_amount) + n(sec.regional_fee);
      if (secAmt <= 0) continue;
      const capped = Math.min(secAmt, Math.max(0, baseTotal - assignedToSecondary));
      if (capped <= 0) continue;
      assignedToSecondary += capped;
      shares.push({
        leader_id: secLeader,
        metro: useMetro ? capped : 0,
        note_amount: 0,
        regional: useMetro ? 0 : capped,
        cod: 0,
        reason: "재방문 2차 분배",
      });
    }
    const firstRemaining = Math.max(0, baseTotal - assignedToSecondary);
    shares.push({
      leader_id: firstLeader as string,
      metro: useMetro ? firstRemaining : 0,
      note_amount: baseNote,
      regional: useMetro ? 0 : firstRemaining,
      cod: baseCod,
      reason: assignedToSecondary > 0 ? "재방문 1차(2차분 차감)" : "재방문 1차 전액",
    });
    out.set(first.id, shares);
  }
  return out;
}

/**
 * 한 행에 대해 특정 팀장이 보게 될 (배송비, 착불) 합계를 반환.
 * 재방문 1차 행 → override 합산값(해당 팀장 몫), 2차+ → null, 그 외 → undefined.
 *   targetIds: 정산귀속 합산 대상 ID 집합 (예: 오은규→오동선이면 두 ID 모두 포함)
 */
export function getRevisitFeeForLeader(
  rowId: string,
  override: Map<string, RevisitShare[]>,
  targetIds: Set<string>,
): { metro: number; regional: number; note_amount: number; cod: number } | null | undefined {
  const ov = override.get(rowId);
  if (ov === undefined) return undefined;
  if (ov.length === 0) return null;
  let metro = 0, regional = 0, note_amount = 0, cod = 0;
  let any = false;
  for (const s of ov) {
    if (!targetIds.has(s.leader_id)) continue;
    metro += s.metro;
    regional += s.regional;
    note_amount += s.note_amount;
    cod += s.cod;
    any = true;
  }
  if (!any) return null;
  return { metro, regional, note_amount, cod };
}