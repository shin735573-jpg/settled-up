const normalizeItemName = (item: unknown): string =>
  String(item ?? "").trim().replace(/\s+/g, "");

const hasValue = (value: unknown): boolean => String(value ?? "").trim().length > 0;

export type VirtualSettlementRowLike = {
  virtual_leader_id?: string | null;
  virtual_leader_name?: string | null;
  leader1_id?: string | null;
  leader2_id?: string | null;
  leader3_id?: string | null;
};

export const isLoadingFeeItem = (item: unknown): boolean =>
  normalizeItemName(item) === "적재비";

/**
 * 팀장정산 제외 품목.
 * 정책 변경(2026-06): 적재비는 더 이상 제외하지 않는다 — 모든 정산(업체/팀장/본사/총배송비)에 포함하며
 * 팀장 귀속은 항상 "삼호" 팀장으로 자동 라우팅한다 (loadingFeeAssigneeName / normalizeLoadingFeeRowLeaders 참조).
 * 별도 제외 품목이 다시 생기면 여기에 추가한다.
 */
export const isLeaderSettlementExcludedItem = (_item: unknown): boolean => false;

/** 적재비를 귀속시킬 팀장 이름 (변경 불가 고정 규칙). */
export const loadingFeeAssigneeName = "삼호";

/** leaders 목록에서 적재비 귀속 팀장(삼호) ID 를 찾는다. */
export const findLoadingFeeAssigneeId = (
  leaders: ReadonlyArray<{ id: string; name?: string | null }>,
): string | null => {
  for (const l of leaders) {
    if (String(l.name ?? "").trim() === loadingFeeAssigneeName) return l.id;
  }
  return null;
};

/**
 * 적재비 행의 팀장 필드를 삼호 단독으로 정규화한 사본을 돌려준다.
 * 적재비가 아니거나 samhoId 가 없으면 입력을 그대로 돌려준다.
 * (split/2인배송/가상기사 입력도 모두 무력화되어 전액 삼호에게 귀속된다.)
 */
export const normalizeLoadingFeeRowLeaders = <T extends {
  item?: unknown;
  leader1_id?: string | null;
  leader2_id?: string | null;
  leader3_id?: string | null;
  virtual_leader_id?: string | null;
  virtual_leader_name?: string | null;
  split_type?: string | null;
  two_person?: boolean | null;
}>(row: T, samhoId: string | null): T => {
  if (!samhoId || !isLoadingFeeItem(row.item)) return row;
  return {
    ...row,
    leader1_id: samhoId,
    leader2_id: null,
    leader3_id: null,
    virtual_leader_id: null,
    virtual_leader_name: null,
    split_type: null,
    two_person: false,
  };
};

/** 가상기사 입력이 포함된 배송은 업체/팀장/본사 모든 정산에서 제외한다. */
export const isVirtualSettlementRow = (
  row: VirtualSettlementRowLike,
  virtualIds?: Set<string> | string[] | null,
): boolean => {
  if (hasValue(row.virtual_leader_id) || hasValue(row.virtual_leader_name)) return true;
  const ids = virtualIds instanceof Set ? virtualIds : new Set(virtualIds || []);
  return [row.leader1_id, row.leader2_id, row.leader3_id].some((id) => !!id && ids.has(id));
};

export const isSettlementExcludedRow = (
  row: VirtualSettlementRowLike & { item?: unknown },
  virtualIds?: Set<string> | string[] | null,
): boolean => isLeaderSettlementExcludedItem(row.item) || isVirtualSettlementRow(row, virtualIds);
