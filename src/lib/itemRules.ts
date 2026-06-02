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

/** 팀장정산에는 배송 업무가 아닌 본사/업체 별도 매출 품목을 절대 합산하지 않는다. */
export const isLeaderSettlementExcludedItem = (item: unknown): boolean =>
  isLoadingFeeItem(item);

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
