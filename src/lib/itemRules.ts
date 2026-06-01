const normalizeItemName = (item: unknown): string =>
  String(item ?? "").trim().replace(/\s+/g, "");

export const isLoadingFeeItem = (item: unknown): boolean =>
  normalizeItemName(item) === "적재비";

/** 팀장정산에는 배송 업무가 아닌 본사/업체 별도 매출 품목을 절대 합산하지 않는다. */
export const isLeaderSettlementExcludedItem = (item: unknown): boolean =>
  isLoadingFeeItem(item);
