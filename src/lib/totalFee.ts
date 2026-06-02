import { isLeaderSettlementExcludedItem } from "./itemRules";
import { isVirtualSettlementRow } from "./itemRules";

// 총배송비 공통 계산기 — 화면별 합산 기준을 한 곳에서 관리한다.
export type DeliveryLike = {
  item?: string | null;
  virtual_leader_id?: string | null;
  virtual_leader_name?: string | null;
  metro_fee?: number | string | null;
  note_amount?: number | string | null;
  regional_fee?: number | string | null;
};

const n = (v: unknown): number => Number(v) || 0;

/** 단일 배송 행의 (수도권 + 비고 + 지방) 합 */
export const rowDeliveryFee = (r: DeliveryLike): number =>
  n(r.metro_fee) + n(r.note_amount) + n(r.regional_fee);

/** 기간 내 전체 배송 행의 총배송비 합 */
export const totalDeliveryFee = (rows: DeliveryLike[]): number =>
  rows.reduce((s, r) => s + rowDeliveryFee(r), 0);

/** 팀장정산 배송비 합 — 적재비 같은 별도 매출 품목은 제외 */
export const totalLeaderSettlementDeliveryFee = (rows: DeliveryLike[]): number =>
  rows.reduce((s, r) => s + (isLeaderSettlementExcludedItem(r.item) || isVirtualSettlementRow(r) ? 0 : rowDeliveryFee(r)), 0);
