/**
 * 재방문 그룹은 업체 청구/카운트에서 1회만 잡혀야 한다.
 * 같은 revisit_group_id의 행 중 visit_no가 가장 낮은(=1차) 행만 남기고
 * 2차 이후 행은 제외한다. 팀장 정산에는 이 함수를 사용하지 말 것
 * (팀장 정산은 방문 회수에 관계 없이 전부 표기).
 */
export function keepRevisitPrimaryOnly<T extends {
  revisit_group_id?: string | null;
  revisit_visit_no?: number | null;
  date?: string | null;
}>(rows: T[]): T[] {
  const primary = new Map<string, T>();
  const result: T[] = [];
  const order: Array<{ gid: string; pos: number }> = [];
  rows.forEach((r) => {
    const gid = r.revisit_group_id;
    if (!gid) {
      result.push(r);
      return;
    }
    const cur = primary.get(gid);
    if (!cur) {
      primary.set(gid, r);
      order.push({ gid, pos: result.length });
      result.push(r);
      return;
    }
    const va = Number(r.revisit_visit_no ?? 1);
    const vb = Number(cur.revisit_visit_no ?? 1);
    const better =
      va < vb || (va === vb && (r.date || "") < (cur.date || ""));
    if (better) {
      primary.set(gid, r);
      const slot = order.find((o) => o.gid === gid);
      if (slot) result[slot.pos] = r;
    }
  });
  return result;
}